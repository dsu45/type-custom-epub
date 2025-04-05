      
document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements (selectors remain the same)
    const fileInput = document.getElementById('epubFile');
    const sourceTextArea = document.getElementById('source-text');
    const textDisplayArea = document.getElementById('text-display-area');
    const wpmDisplay = document.getElementById('wpm');
    const accuracyDisplay = document.getElementById('accuracy');
    const errorsDisplay = document.getElementById('errors');
    const bookProgressDisplay = document.getElementById('bookProgress');
    const prevChapterButton = document.getElementById('prevChapter');
    const nextChapterButton = document.getElementById('nextChapter');
    const chapterInfoDisplay = document.getElementById('chapterInfo');
    const hiddenInput = document.getElementById('hidden-input');
    const P_BREAK_PLACEHOLDER = '¶'; // Using Pilcrow symbol as placeholder

    // State Variables
    let book = null;
    let currentFilename = null; // Will be set by loadLastOpenedFilePreference
    let spineItems = [];
    let currentChapterIndex = 0; // Default starting point
    let currentChapterText = "";
    let currentTypedIndex = 0; // Default starting point
    let errors = 0;
    let totalTyped = 0;
    let startTime = null;
    let isLoading = false;
    let totalBookCharacters = 0;
    let chapterLengths = []; // Array of chapter lengths
    let bookLengthCalculated = false; // <<< Flag for caching
    let initialCharIndexToLoad = 0; // Dedicated var for loading progress
    // Chunking State
    const CHUNK_SIZE = 6; // Number of paragraphs per chunk
    let chapterChunks = []; // Array of paragraph arrays [[p1, p2,...], [p7, p8,...]]
    let currentChunkIndex = 0;
    let currentChunkText = ""; // The text content of the current chunk
    let currentTypedIndexInChunk = 0; // Typing index WITHIN the current chunk
    let chunkStartIndexInChapter = 0; // Character index where the current chunk starts in the ORIGINAL chapter text

    const LAST_OPENED_KEY = 'epubTyperLastOpenedFile';
    const PROGRESS_KEY_PREFIX = 'epubTyperProgress_'; // Includes progress AND cached length data

    // --- Initialization ---
    loadLastOpenedFilePreference(); // Sets currentFilename if available
    resetUI(); // Updates UI based *only* on currentFilename presence

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileSelect);
    prevChapterButton.addEventListener('click', () => navigateChapter(-1));
    nextChapterButton.addEventListener('click', () => navigateChapter(1));
    document.addEventListener('keydown', handleKeyDown);
    sourceTextArea.addEventListener('click', () => hiddenInput.focus()); // Keep focus logic


    // --- Core Functions ---

    function loadLastOpenedFilePreference() {
        const lastFile = localStorage.getItem(LAST_OPENED_KEY);
        if (lastFile) {
            console.log("Previously opened file found:", lastFile);
            currentFilename = lastFile; // ONLY set the filename
        } else {
            currentFilename = null; // Ensure it's null if nothing is stored
        }
        // DO NOT call resetUI here. Let DOMContentLoaded handle it.
    }

    async function handleFileSelect(event) {
        const file = event.target.files[0];
        const expectedFilename = currentFilename; // Store the potentially pre-loaded filename from page load

        // Validation check using 'file'
        if (isLoading || !file || !file.name.endsWith('.epub')) {
           if (file && !file.name.endsWith('.epub')) { // Check if 'file' exists but is wrong type
               alert("Please select a valid .epub file.");
           } else if (!file) {
                console.log("No file selected."); // Handle case where no file is chosen after prompt
           }
           // If isLoading is true, log that too
           if (isLoading) {
               console.log("handleFileSelect: Aborted because isLoading is true.");
           }
           try { fileInput.value = ''; } catch(e) { console.warn("Couldn't clear file input");}
           return; // Exit if loading, no file, or wrong file type
        }

        // --- Check if selected file matches the expected one (if any) ---
        const selectedFilename = file.name;
        if (expectedFilename && selectedFilename !== expectedFilename) {
            console.log(`Selected file '${selectedFilename}' differs from expected '${expectedFilename}'. Resetting progress and state.`);
            // Clear progress associated with the OLD filename before proceeding
             clearProgress(expectedFilename); // Clear old progress
             resetState(true); // Full reset including filename, chapter index, etc.
             currentFilename = selectedFilename; // Set to the NEW selected filename
             // UI will be reset implicitly by loading the new file below
        } else {
             // Filename matches expected, or no specific file was expected
             currentFilename = selectedFilename; // Ensure it's set for the loading process
             // If filename matches, we only need a partial reset
             resetState(false); // Keep filename, reset typing/chapter state
        }
        // --- END Check ---


        console.log(`handleFileSelect: Starting for ${currentFilename}`);
        // resetState(false) was called above if filename matched

        console.log(`handleFileSelect: Setting isLoading = true`);
        setLoadingState(true, "Loading EPUB...");

        const reader = new FileReader();

        reader.onload = async (e) => {
            console.log(`handleFileSelect: reader.onload started.`);
            const arrayBuffer = e.target.result;
            try {
                book = ePub(arrayBuffer);
                await book.ready;
                await book.spine.ready;

                spineItems = book.spine.spineItems;
                if (!spineItems || !Array.isArray(spineItems) || spineItems.length === 0) {
                     throw new Error("EPUB spine data is invalid or empty.");
                }
                console.log(`handleFileSelect: Spine ready, found ${spineItems.length} items.`);

                // --- Load progress (for the confirmed currentFilename) ---
                // This ensures progress (including cached lengths) is loaded for the file being processed.
                loadProgress();
                console.log(`handleFileSelect: loadProgress finished. Target chapter index: ${currentChapterIndex}. Initial char index: ${initialCharIndexToLoad}`);

                // --- Calculate or Use Cached Book Length ---
                if (!bookLengthCalculated) {
                    console.log(`handleFileSelect: Calculating book length...`);
                    // Consider adding setLoadingState here if calculation is long
                    // setLoadingState(true, "Calculating book length...");
                    await calculateTotalBookCharacters(); // Calculates and sets bookLengthCalculated flag
                    console.log(`handleFileSelect: Book length calculation finished.`);
                    // If you added setLoadingState above, set it false here if needed,
                    // but the main setLoadingState(false) below should handle it.
                } else {
                    console.log("handleFileSelect: Using cached book length data.");
                    updateBookProgress(); // Update display with cached data now that spine is ready
                }

                // --- Save Preferences and Load Chapter ---
                localStorage.setItem(LAST_OPENED_KEY, currentFilename); // Save the *actually* loaded filename

                console.log(`handleFileSelect: Setting isLoading = false before calling loadChapter.`);
                setLoadingState(false);

                console.log(`handleFileSelect: isLoading is now ${isLoading}. Calling loadChapter(${currentChapterIndex}).`);
                await loadChapter(currentChapterIndex); // Load the target chapter

                console.log(`handleFileSelect: loadChapter call finished.`);
                // Save progress AFTER chapter load, which includes potential completion check
                saveProgress();

            } catch (err) {
                 console.error("handleFileSelect: Error processing EPUB:", err);
                 alert(`Could not load or parse the EPUB file: ${err.message || 'Unknown error'}`);
                 clearProgress(currentFilename); // Clear potentially corrupted progress
                 resetState(true); // Full reset on critical error
                 resetUI(); // Show initial prompt again
                 console.log(`handleFileSelect: Error catch - Setting isLoading = false`);
                 setLoadingState(false); // Ensure loading is off on error
            }
        };

        reader.onerror = () => {
            console.error("Error reading file.");
            alert('Error reading file.');
            resetState(true);
            resetUI();
            console.log(`handleFileSelect: reader.onerror - Setting isLoading = false`);
            setLoadingState(false); // Ensure it's off on reader error too
        };

        reader.readAsArrayBuffer(file);
    }


    // Calculates (if needed) AND updates state variables
    async function calculateTotalBookCharacters() {
        totalBookCharacters = 0;
        chapterLengths = new Array(spineItems.length).fill(0);
        console.log("Calculating total characters for all chapters...");
        bookLengthCalculated = false; // Start assuming calculation is needed

        try {
            for (let i = 0; i < spineItems.length; i++) {
                const section = spineItems[i];
                if (section && typeof section.load === 'function') {
                    const contents = await section.load(book.load.bind(book));
                    let bodyContent = '';
                    if (contents instanceof Document || contents instanceof Node) {
                        const bodyElement = contents.querySelector('body');
                        bodyContent = bodyElement ? bodyElement.innerHTML : contents.textContent || '';
                    } else if (typeof contents === 'string') {
                        bodyContent = contents;
                    }

                    // --- PRE-PROCESS HTML for Breaks ---
                    let processedHtml = bodyContent
                        .replace(/<\/p>/gi, '\n\n')
                        .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')
                        .replace(/<p.*?>/gi, '\n') // Keep this for potential separation before processing
                        .replace(/<br.*?>/gi, '\n');
                    // --- END PRE-PROCESS ---

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = processedHtml;
                    let rawText = (tempDiv.textContent || '');
                    tempDiv.remove();


                    // --- NORMALIZE Text Content ---
                    rawText = rawText
                        .replace(/\r\n/g, '\n') // Standardize line endings
                        .replace(/ /g, ' ') // Handle non-breaking spaces
                        .replace(/(\s|^)(\d+\.\d+)\s+([A-Z])/g, `$1${P_BREAK_PLACEHOLDER}$2 $3`) // Headers
                        .replace(/\n{2,}/g, P_BREAK_PLACEHOLDER) // Double newlines
                        .replace(/\n/g, ' ') // Single newlines
                        .replace(/—/g, '-') // Em dash
                        .replace(/[“”]/g, '"') // Smart quotes
                        .replace(/[‘’]/g, "'") // Smart quotes
                        .replace(/©/g, 'c') // <<< ADDED: Replace copyright symbol
                        .replace(/\s+/g, ' ') // Collapse multiple spaces
                        .replace(new RegExp(`${P_BREAK_PLACEHOLDER}\\s+`, 'g'), P_BREAK_PLACEHOLDER) // Space after break
                        .replace(new RegExp(`[${P_BREAK_PLACEHOLDER}\\s]+\\s*(\\d+\\.\\d+)`, 'g'), '$1') // Break/space before header
                        .replace(new RegExp(`^[${P_BREAK_PLACEHOLDER}\\s]+|[${P_BREAK_PLACEHOLDER}\\s]+$`, 'g'), ''); // Trim breaks/spaces
                    // --- END NORMALIZE ---

                    // Double check removal of space after placeholder
                    rawText = rawText.replace(new RegExp(`${P_BREAK_PLACEHOLDER}\\s+`, 'g'), P_BREAK_PLACEHOLDER);

                    chapterLengths[i] = rawText.length;
                    totalBookCharacters += rawText.length;
                } else {
                    console.warn(`Skipping section ${i} during length calculation: Invalid section or load function.`);
                    chapterLengths[i] = 0; // Assign 0 length if skipped
                }
            }
            console.log(`Total calculated book characters: ${totalBookCharacters}`);
            bookLengthCalculated = true; // Mark calculation as complete
            updateBookProgress(); // Update display immediately after calculation

        } catch (error) {
            console.error("Error during total character calculation:", error);
            totalBookCharacters = 0; // Reset on error
            chapterLengths = [];
            bookLengthCalculated = false; // Ensure flag is false on error
            bookProgressDisplay.textContent = "Book: N/A";
        }
    }


          
          
          
          
          
    async function loadChapter(chapterIndex) {
        console.log(`loadChapter(${chapterIndex}): Function called.`);
        // Basic validation checks...
        if (!spineItems || spineItems.length === 0 || isLoading || chapterIndex < 0 || chapterIndex >= spineItems.length) {
        let reason = `chapterIndex=${chapterIndex}, spineLength=${spineItems?.length ?? 'N/A'}`;
        if (isLoading) reason += `, isLoading=true`;
        if (!spineItems || spineItems.length === 0) reason += `, no spineItems`;
        if (chapterIndex < 0) reason += `, chapterIndex < 0`;
        if (spineItems && chapterIndex >= spineItems.length) reason += `, chapterIndex >= spineLength`;
        console.warn(`loadChapter: Aborted entry validation. Reason(s): ${reason}`);
        if(isLoading) setLoadingState(false); // Turn off loading if aborting due to it
            if (!spineItems || spineItems.length === 0) { // Also show error if spine missing
                sourceTextArea.innerHTML = "<p style='color: red;'>Cannot load chapter: EPUB data missing.</p>";
            }
        return;
        }

        console.log(`loadChapter(${chapterIndex}): Passed entry validation. Setting isLoading = true.`);
        setLoadingState(true, `Loading Chapter ${chapterIndex + 1}...`);
        currentChapterIndex = chapterIndex; // Set the actual current chapter index
        let chapterSuccessfullyLoaded = false;

        // Reset chunk state for the new chapter
        chapterChunks = [];
        currentChunkIndex = 0;
        currentChunkText = "";
        currentTypedIndexInChunk = 0;
        chunkStartIndexInChapter = 0;


        try {
            // --- Retrieve saved starting index DIRECTLY from localStorage ---
            let overallSavedCharIndex = 0; // Where were we in the *entire* chapter?
            if (currentFilename) { // Only try if a filename is set
                const key = PROGRESS_KEY_PREFIX + currentFilename;
                const savedData = localStorage.getItem(key);
                if (savedData) {
                    try {
                        const progressData = JSON.parse(savedData);
                        // Check if chapter progress exists for this specific chapter
                        if (progressData.chapterProgress && typeof progressData.chapterProgress === 'object') {
                            const savedValue = progressData.chapterProgress[String(chapterIndex)]; // Use string key
                            if (typeof savedValue === 'number' && savedValue >= 0) {
                                overallSavedCharIndex = savedValue;
                                console.log(`loadChapter(${chapterIndex}): Found overall saved progress index from localStorage: ${overallSavedCharIndex}`);
                            } else {
                                console.log(`loadChapter(${chapterIndex}): No saved progress found for THIS chapter in localStorage.`);
                            }
                        } else {
                            console.log(`loadChapter(${chapterIndex}): chapterProgress map missing in localStorage data.`);
                        }
                    } catch (e) {
                        console.error(`loadChapter(${chapterIndex}): Error parsing localStorage data:`, e);
                        // Proceed with index 0 if parsing fails
                    }
                } else {
                    console.log(`loadChapter(${chapterIndex}): No saved progress found for file ${currentFilename} in localStorage.`);
                }
            } else {
                console.log(`loadChapter(${chapterIndex}): No currentFilename set, cannot load progress.`);
            }
            // --- End Retrieve starting index ---


            const section = spineItems[currentChapterIndex];
            if (!section || typeof section.load !== 'function') {
                throw new Error(`Invalid spine section at index ${currentChapterIndex}.`);
            }

            // --- Load section content & Normalize (remains the same) ---
            const contents = await section.load(book.load.bind(book));
            console.log(`loadChapter(${chapterIndex}): Section content loaded.`);
            let bodyContent = '';
            if (contents instanceof Document || contents instanceof Node) {
                const bodyElement = contents.querySelector('body');
                bodyContent = bodyElement ? bodyElement.innerHTML : contents.textContent || '';
            } else if (typeof contents === 'string') {
                bodyContent = contents;
            }

            let processedHtml = bodyContent
                .replace(/<\/p>/gi, '\n\n')
                .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')
                .replace(/<p.*?>/gi, '\n')
                .replace(/<br.*?>/gi, '\n');
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = processedHtml;
            let rawText = (tempDiv.textContent || '');
            tempDiv.remove();

            // --- NORMALIZE Text Content ---
            rawText = rawText
                .replace(/\r\n/g, '\n') // Standardize line endings
                .replace(/ /g, ' ') // Handle non-breaking spaces
                .replace(/(\s|^)(\d+\.\d+)\s+([A-Z])/g, `$1${P_BREAK_PLACEHOLDER}$2 $3`) // Headers
                .replace(/\n{2,}/g, P_BREAK_PLACEHOLDER) // Double newlines
                .replace(/\n/g, ' ') // Single newlines
                .replace(/—/g, '-') // Em dash
                .replace(/[“”]/g, '"') // Smart quotes
                .replace(/[‘’]/g, "'") // Smart quotes
                .replace(/©/g, 'c') // <<< ADDED: Replace copyright symbol
                .replace(/\s+/g, ' ') // Collapse multiple spaces
                .replace(new RegExp(`${P_BREAK_PLACEHOLDER}\\s+`, 'g'), P_BREAK_PLACEHOLDER) // Space after break
                .replace(new RegExp(`[${P_BREAK_PLACEHOLDER}\\s]+\\s*(\\d+\\.\\d+)`, 'g'), '$1') // Break/space before header
                .replace(new RegExp(`^[${P_BREAK_PLACEHOLDER}\\s]+|[${P_BREAK_PLACEHOLDER}\\s]+$`, 'g'), ''); // Trim breaks/spaces
            // --- END NORMALIZE ---

            // Set the full chapter text (still needed for calculations)
            currentChapterText = rawText;
            console.log(`loadChapter(${chapterIndex}): Full chapter text processed. Length: ${currentChapterText.length} chars.`);

            // --- Optional: Validate/Update Chapter Length Cache ---
            // (Logic remains the same as before)
            if (bookLengthCalculated && chapterLengths.length > chapterIndex) {
                if ((chapterLengths[chapterIndex] || 0) !== currentChapterText.length) {
                    console.warn(`loadChapter: Updating chapter length cache for index ${chapterIndex}. Old: ${chapterLengths[chapterIndex]}, New: ${currentChapterText.length}.`);
                    chapterLengths[chapterIndex] = currentChapterText.length;
                    totalBookCharacters = chapterLengths.reduce((sum, len) => sum + (len || 0), 0);
                    console.log(`Total book characters updated to: ${totalBookCharacters}`);
                    const key = PROGRESS_KEY_PREFIX + currentFilename;
                    const savedData = localStorage.getItem(key);
                    if(savedData) {
                        try {
                        let progressData = JSON.parse(savedData);
                        if(!progressData.bookLengthData) progressData.bookLengthData = {};
                        progressData.bookLengthData.totalChars = totalBookCharacters;
                        progressData.bookLengthData.chapLengths = chapterLengths;
                        localStorage.setItem(key, JSON.stringify(progressData));
                        console.log("Updated bookLengthData in localStorage");
                        } catch(e) { console.error("Failed to update bookLengthData in storage", e); }
                    }
                }
            } else if (bookLengthCalculated) {
                console.warn("Book length was calculated, but chapterLengths array seems inconsistent.");
            } else if (!bookLengthCalculated && spineItems.length > 0) {
                console.log("loadChapter: Book length cache not loaded, length data might be inaccurate until calculated.");
            }
            // --- End Chapter length caching/validation ---

            // --- Split into Paragraphs and Create Chunks (Remains the same) ---
            const paragraphs = currentChapterText.split(P_BREAK_PLACEHOLDER).filter(p => p.length > 0);
            chapterChunks = [];
            for (let i = 0; i < paragraphs.length; i += CHUNK_SIZE) {
                chapterChunks.push(paragraphs.slice(i, i + CHUNK_SIZE));
            }
            if (chapterChunks.length === 0 && currentChapterText.length > 0) {
                chapterChunks.push([currentChapterText]);
                console.log("loadChapter: Chapter has text but no placeholders, treating as single chunk.");
            } else if (chapterChunks.length === 0) {
                console.log(`loadChapter: Chapter ${chapterIndex+1} appears empty after chunking.`);
            }
            console.log(`loadChapter: Chapter split into ${chapterChunks.length} chunk(s) of ~${CHUNK_SIZE} paragraphs.`);
            // --- End Chunk Creation ---


            // --- Determine Initial Chunk and Index within Chunk (Remains the same logic) ---
            let initialChunkIndex = 0;
            let charIndexOffsetInChunk = 0;

            if (overallSavedCharIndex > 0 && chapterChunks.length > 0) {
                let charCount = 0;
                let foundChunk = false;
                for (let i = 0; i < chapterChunks.length; i++) {
                    const chunkParas = chapterChunks[i];
                    let currentChunkLength = 0;
                    if (chunkParas && chunkParas.length > 0) {
                        currentChunkLength = chunkParas[0].length;
                        for (let j = 1; j < chunkParas.length; j++) { currentChunkLength += 1 + chunkParas[j].length; }
                    }

                    if (overallSavedCharIndex >= charCount && overallSavedCharIndex < charCount + currentChunkLength) {
                        initialChunkIndex = i;
                        charIndexOffsetInChunk = overallSavedCharIndex - charCount;
                        foundChunk = true; break;
                    }
                    else if (overallSavedCharIndex === charCount + currentChunkLength + 1 && i < chapterChunks.length - 1) {
                        initialChunkIndex = i + 1;
                        charIndexOffsetInChunk = 0;
                        foundChunk = true; break;
                    }
                    else if (overallSavedCharIndex === charCount + currentChunkLength) {
                        initialChunkIndex = i;
                        charIndexOffsetInChunk = currentChunkLength;
                        foundChunk = true; break;
                    }
                    charCount += currentChunkLength + 1;
                }

                if (!foundChunk) {
                    console.warn(`Saved index ${overallSavedCharIndex} seems beyond chapter end. Loading last chunk at end.`);
                    initialChunkIndex = chapterChunks.length - 1;
                    charCount = 0;
                    for (let i=0; i<initialChunkIndex; i++) { /* Recalculate charCount */
                        const chunkParas = chapterChunks[i];
                        if (chunkParas && chunkParas.length > 0) {
                            let prevChunkLen = chunkParas[0].length;
                            for(let j=1; j<chunkParas.length; j++) { prevChunkLen += 1 + chunkParas[j].length; }
                            charCount += prevChunkLen + 1;
                        }
                    }
                    const lastChunkParas = chapterChunks[initialChunkIndex];
                    let lastChunkLen = 0;
                    if(lastChunkParas && lastChunkParas.length > 0) { /* Calculate lastChunkLen */
                        lastChunkLen = lastChunkParas[0].length;
                        for(let j=1; j<lastChunkParas.length; j++) { lastChunkLen += 1 + lastChunkParas[j].length; }
                    }
                    charIndexOffsetInChunk = lastChunkLen;
                }
            }
            console.log(`loadChapter: Determined initial chunk: ${initialChunkIndex}, offset: ${charIndexOffsetInChunk}`);
            // --- End Initial Chunk Determination ---

            // Load the determined chunk
            loadChunk(initialChunkIndex, charIndexOffsetInChunk); // Pass offset

            chapterSuccessfullyLoaded = true; // Chapter setup successful

    } catch (err) {
        console.error(`loadChapter(${chapterIndex}): Error during chapter setup:`, err);
        sourceTextArea.innerHTML = `<p style="color: red;">Error loading chapter ${currentChapterIndex + 1}: ${err.message}</p>`;
        chapterSuccessfullyLoaded = false;
            resetTypingStateForNewChapter(); // Reset global chapter stats
            updateNavigation();
            updateBookProgress();
    } finally {
        console.log(`loadChapter(${chapterIndex}): Chapter setup finished. Setting isLoading = false.`);
        setLoadingState(false); // Ensure loading is off
            // Focusing is handled within loadChunk now
    }
    } // End loadChapter




    
    function displayChapterText() {
        if (currentChapterText == null) {
             sourceTextArea.innerHTML = "<p style='color: red;'>Error: Chapter text unavailable.</p>";
             return;
         }

        // --- MODIFIED SPAN MAPPING ---
        const htmlContent = currentChapterText
            .split('')
            .map((char, index) => {
                if (char === P_BREAK_PLACEHOLDER) {
                    // Output double line breaks for the placeholder
                    return '<br><br>';
                } else {
                    // Output regular span for other characters
                    // Use non-breaking space for display to ensure spacing is visible
                    const displayChar = char === ' ' ? ' ' : char;
                    return `<span id="char-${index}">${displayChar}</span>`;
                }
            })
            .join('');
        // --- END MODIFIED SPAN MAPPING ---

        sourceTextArea.innerHTML = htmlContent;

        console.log("Chapter text rendered with paragraph breaks.");

        if (currentChapterText.length === 0 || sourceTextArea.innerHTML === '') { // Check if result is empty
             sourceTextArea.innerHTML = "<p>(Chapter appears empty)</p>";
        } else {
            // Cursor update will happen in loadChapter after potential index is applied
        }

         try {
            hiddenInput.focus();
         } catch (e) {
             console.warn("Could not focus hidden input:", e);
         }
    }

    // handleKeyDown remains largely the same as the previous version
    // (with Ctrl+Backspace, regular backspace, character typing logic)
          
          
          
          
          
    function handleKeyDown(event) {
        // Initial checks (loading, chunk loaded?)
        if (isLoading || currentChunkText == null) { // Check currentChunkText
            console.log("handleKeyDown ignored: isLoading or no chunk text.");
            return;
         }

        const key = event.key;

        // --- Arrow Key Chunk Navigation ---
        if (key === 'ArrowLeft') {
            event.preventDefault();
            navigateChunk(-1);
            return;
        }
        if (key === 'ArrowRight') {
            event.preventDefault();
            navigateChunk(1);
            return;
        }
        // --- End Arrow Key Navigation ---


        // Allow backspace even if technically "finished" with the chunk
        if (currentTypedIndexInChunk >= currentChunkText.length && key !== 'Backspace') {
             // Allow Enter/Space if the very last character needs enter
             let lastCharNeedsEnter = false;
             if (currentTypedIndexInChunk > 0) {
                 const lastSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk - 1}`);
                 lastCharNeedsEnter = lastSpan?.classList.contains('needs-enter') ?? false;
             }
             if (!(lastCharNeedsEnter && (key === 'Enter' || key === ' '))) {
                  console.log("handleKeyDown ignored: At end of chunk and key is not Backspace or needed Enter/Space.");
                  return; // Ignore other keys at the end
             }
        }

        const isCtrlBackspace = event.ctrlKey && key === 'Backspace';

        // --- Prevent Default Actions ---
        if (key === ' ' || key === 'Backspace' || key === 'Enter') {
            event.preventDefault();
        }

        // Ignore other non-typing keys
        if (key.length > 1 && key !== 'Backspace' && key !== 'Enter' && !isCtrlBackspace) {
             console.log("handleKeyDown ignored: Non-typing helper key:", key);
             return;
        }

        // --- Handle Backspace (operates on chunk) ---
        if (key === 'Backspace') {
            event.preventDefault();

            if (isCtrlBackspace) {
                // Ctrl+Backspace Logic (simplified for chunk context)
                if (currentTypedIndexInChunk === 0) return;
                const originalIndex = currentTypedIndexInChunk;
                let targetIndex = currentTypedIndexInChunk - 1;
                // Skip trailing spaces (placeholders are handled by needs-enter logic)
                while (targetIndex >= 0 && /\s/.test(currentChunkText[targetIndex])) { targetIndex--; }
                // Find start of word
                while (targetIndex >= 0 && !/\s/.test(currentChunkText[targetIndex]) && currentChunkText[targetIndex] !== P_BREAK_PLACEHOLDER) { targetIndex--; }
                const newIndex = targetIndex + 1;

                // Clear styles between newIndex and originalIndex
                for (let i = newIndex; i < originalIndex; i++) {
                    if (currentChunkText[i] === P_BREAK_PLACEHOLDER) continue;
                    const charSpan = document.getElementById(`chunk-char-${i}`); // Use chunk ID
                    if (charSpan) {
                        if (charSpan.classList.contains('incorrect')) { errors = Math.max(0, errors - 1); }
                        charSpan.classList.remove('correct', 'incorrect', 'current', 'needs-enter');
                    }
                }
                currentTypedIndexInChunk = newIndex;

            } else {
                // Regular Backspace Logic
                if (currentTypedIndexInChunk > 0) {
                     const indexToClear = currentTypedIndexInChunk - 1;
                     currentTypedIndexInChunk--; // Move index back first

                    // Clear style of the character span we just backspaced *over*
                    const charSpan = document.getElementById(`chunk-char-${indexToClear}`); // Use chunk ID
                    if (charSpan) {
                        if (charSpan.classList.contains('incorrect')) { errors = Math.max(0, errors - 1); }
                        charSpan.classList.remove('correct', 'incorrect', 'current', 'needs-enter');
                        console.log(`Backspace cleared style from chunk index ${indexToClear}`);
                    }

                    // Remove 'needs-enter' from the *new* preceding char if necessary
                     if(currentTypedIndexInChunk > 0) {
                          const newPrecedingSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk - 1}`);
                          if (newPrecedingSpan?.classList.contains('needs-enter')) {
                               newPrecedingSpan.classList.remove('needs-enter');
                               console.log(`Backspace removed needs-enter from chunk index ${currentTypedIndexInChunk - 1}`);
                          }
                     }


                    // Reset timer if backspacing to the very beginning of the chunk
                    if (currentTypedIndexInChunk === 0 && totalTyped <= 1) {
                         startTime = null;
                         totalTyped = 0;
                         console.log("Timer reset due to backspace to chunk start.");
                    }
                }
            }

            // Update UI after backspace
            updateCursor();
            updateStats();
            updateBookProgress(); // Recalculates overall progress
            saveProgress(); // Saves overall chapter progress
            return;
        } // End Backspace Handling


        // --- Handle Typing / Enter / Space Key (operates on chunk) ---

        // Check if the character BEFORE the current index needs Enter/Space
        let needsEnter = false;
        let precedingSpan = null;
        if (currentTypedIndexInChunk > 0) {
            precedingSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk - 1}`); // Chunk ID
            needsEnter = precedingSpan?.classList.contains('needs-enter') ?? false;
        }

        // Get expected character at the current cursor position within the chunk
        const expectedChar = (currentTypedIndexInChunk < currentChunkText.length) ? currentChunkText[currentTypedIndexInChunk] : null;

        // --- Case 1: NEEDS Enter/Space ---
        if (needsEnter) {
            if (key === 'Enter' || key === ' ') {
                console.log(`Key '${key}' pressed correctly at needs-enter point after chunk index ${currentTypedIndexInChunk - 1}.`);
                if (precedingSpan) {
                    precedingSpan.classList.remove('incorrect', 'needs-enter');
                    precedingSpan.classList.add('correct');
                }
                if (!startTime && totalTyped === 0) startTime = new Date();

                // --- ADDED: Skip subsequent placeholders ---
                // We've conceptually handled the break before currentTypedIndexInChunk.
                // Now, advance past any placeholder characters AT or immediately AFTER this index.
                while (currentTypedIndexInChunk < currentChunkText.length && currentChunkText[currentTypedIndexInChunk] === P_BREAK_PLACEHOLDER) {
                    console.log(`handleKeyDown: Skipping placeholder at chunk index ${currentTypedIndexInChunk} after correct Enter/Space.`);
                    currentTypedIndexInChunk++;
                }
                // --- END ADDED ---

                // Now currentTypedIndexInChunk points to the next non-placeholder character or the end.
                updateCursor(); // This will now target the correct next character span.
                updateStats();
                updateBookProgress();
                saveProgress(); // Save progress reflecting the cleared break AND skipped placeholders.
                return; // ★★★ Stop processing here ★★★

            } else { // Incorrect key at needs-enter
                console.log(`Incorrect key '${key}' pressed at needs-enter point.`);
                 if (precedingSpan && !precedingSpan.classList.contains('incorrect')) {
                    errors++;
                    precedingSpan.classList.add('incorrect');
                    precedingSpan.classList.remove('correct');
                    updateStats();
                 }
                 if (precedingSpan) precedingSpan.classList.add('needs-enter'); // Keep cue
                 return; // DO NOT ADVANCE
            }
        } // --- End Case 1 ---


        // --- Case 2: Regular Typing ---
        if (key === 'Enter') { // Ignore Enter if not needed
            console.log("Enter ignored.");
            return;
        }

        if (expectedChar === null) { // At end of chunk text
            console.log("At end of chunk, ignoring non-backspace/nav keys.");
            return;
        }

        // This logic should not be reachable if needsEnter is true, but safeguard:
        if (expectedChar === P_BREAK_PLACEHOLDER) {
             console.error(`Logic Error: Attempting to type at placeholder chunk index ${currentTypedIndexInChunk}.`);
             return;
        }


        if (key.length === 1) { // Regular character or space
            const typedChar = key;
            const charSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk}`); // Chunk ID
            if (!charSpan) { console.error(`Chunk span not found: index ${currentTypedIndexInChunk}`); return; }

            if (!startTime) startTime = new Date();

            // Check correctness (remains same)
            const isExpectedSpace = (expectedChar === ' ' || expectedChar === '\u00A0');
            const isTypedSpace = (typedChar === ' ');
            let correct = false;
            if ((isTypedSpace && isExpectedSpace) || (!isExpectedSpace && typedChar === expectedChar)) {
                correct = true;
                charSpan.classList.add('correct');
                charSpan.classList.remove('incorrect', 'current', 'needs-enter');
            } else {
                correct = false;
                if (!charSpan.classList.contains('incorrect')) { errors++; }
                charSpan.classList.add('incorrect');
                charSpan.classList.remove('correct', 'current', 'needs-enter');
            }
            totalTyped++;

            const processedChunkIndex = currentTypedIndexInChunk;
            currentTypedIndexInChunk++; // Advance index IN CHUNK

            // Check if the NEXT character IN CHUNK is a placeholder
            let nextCharIsBreak = (currentTypedIndexInChunk < currentChunkText.length && currentChunkText[currentTypedIndexInChunk] === P_BREAK_PLACEHOLDER);

            if (nextCharIsBreak) {
                 console.log(`Next char at chunk index ${currentTypedIndexInChunk} is a break.`);
                 const spanToMark = document.getElementById(`chunk-char-${processedChunkIndex}`); // Mark the one just typed
                 if (spanToMark) {
                     if(correct) { spanToMark.classList.add('needs-enter'); }
                     else { spanToMark.classList.remove('needs-enter'); }
                 }
            }

            updateCursor();
            updateStats();
            updateBookProgress();
            saveProgress(); // Save overall chapter progress

            // --- Check for Chunk Completion & Auto-Advance ---
            if (currentTypedIndexInChunk >= currentChunkText.length && !nextCharIsBreak) { // Reached end and NOT waiting for enter
                console.log(`Completed chunk ${currentChunkIndex}.`);
                if (currentChunkIndex < chapterChunks.length - 1) {
                     console.log("Auto-advancing to next chunk...");
                     // Use setTimeout to allow UI to update briefly before loading next
                     setTimeout(() => navigateChunk(1), 100); // Short delay
                } else {
                     console.log("Last chunk of the chapter completed.");
                     // Optional: Auto-advance to next CHAPTER?
                     // setTimeout(() => navigateChapter(1), 200);
                     // Or just mark chapter visually complete
                     markChapterAsCompletedUI(); // Ensure styles are fully correct
                }
            }
            return; // Handled regular typing
        }

        console.log("handleKeyDown: Unhandled key:", key);
   } // End handleKeyDown





    function navigateChapter(direction) {
        if (isLoading || !spineItems || spineItems.length === 0) return;
        const newIndex = currentChapterIndex + direction;
        if (newIndex >= 0 && newIndex < spineItems.length) {
            initialCharIndexToLoad = 0; // Reset char index when navigating chapters
            loadChapter(newIndex);
        }
    }

    // --- Utility Functions ---

    function updateCursor() {
        // 1. Remove cursor from previous position
        const previousChar = sourceTextArea.querySelector('span.current');
        if (previousChar) previousChar.classList.remove('current');

        // 2. Determine the target index for the cursor (always the current typing index)
        const targetIndexInChunk = currentTypedIndexInChunk;

        // 3. Check if the target index is within the bounds of the current chunk's text
        if (currentChunkText && targetIndexInChunk < currentChunkText.length) {

            // Find the span corresponding to the target index
            const targetSpan = document.getElementById(`chunk-char-${targetIndexInChunk}`);

            if (targetSpan) {
                // 4. Add the 'current' class to the target span
                targetSpan.classList.add('current');
                // console.log(`updateCursor: Set current class on chunk index ${targetIndexInChunk}`);

                // 5. Center Scrolling Logic
                try {
                    const spanRect = targetSpan.getBoundingClientRect();
                    const areaRect = textDisplayArea.getBoundingClientRect();
                    // Check if span is fully or partially outside the visible area vertically
                    if (spanRect.top < areaRect.top || spanRect.bottom > areaRect.bottom) {
                        const spanTop = targetSpan.offsetTop;
                        const areaHeight = textDisplayArea.clientHeight;
                        // Calculate target scroll position to center the span
                        const targetScrollTop = spanTop - (areaHeight / 2) + (spanRect.height / 2);
                        // Scroll smoothly to the target position, ensuring it's not negative
                        textDisplayArea.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
                    }
                } catch (e) {
                    console.warn("Center scrolling failed:", e);
                    // Basic fallback: scroll the element into view if error occurs
                    try { targetSpan.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
                }

            } else {
                // This case should ideally not happen if index is < length
                console.warn(`updateCursor: Chunk span not found for index ${targetIndexInChunk}, though index is within bounds.`);
            }
        } else if (currentChunkText) {
            // 6. Handle end of chunk text (index >= length)
            console.log("updateCursor: Index is at or beyond end of chunk text.");
            // Check if the *last* character visually needs the enter cue (means we are waiting)
            if (targetIndexInChunk > 0) {
                const lastCharSpan = document.getElementById(`chunk-char-${targetIndexInChunk - 1}`);
                 if(lastCharSpan?.classList.contains('needs-enter')) {
                      // If waiting for enter on the last char, keep cursor on it
                      lastCharSpan.classList.add('current');
                      console.log(`updateCursor: At end, keeping cursor on last char (needs-enter) index ${targetIndexInChunk - 1}`);
                      // Ensure it's scrolled into view
                      try { lastCharSpan.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
                      return; // Don't scroll to bottom yet
                 }
            }
            // If truly finished (not waiting for enter at the end), scroll to bottom
            textDisplayArea.scrollTop = textDisplayArea.scrollHeight;
        }
        // Handle case where currentChunkText might be null/empty initially
        else {
             console.log("updateCursor: No chunk text available.");
        }
    }

    // updateStats remains the same
    function updateStats() {
        const currentTime = new Date();
        const timeElapsed = (startTime && startTime instanceof Date) ? (currentTime - startTime) / 1000 / 60 : 0; // Minutes
        let currentWpm = 0;
         if (timeElapsed > 0 && totalTyped > 0) {
             const grossWords = (totalTyped / 5);
             currentWpm = Math.round(grossWords / timeElapsed);
             currentWpm = Math.max(0, currentWpm);
         }
        const correctlyTyped = Math.max(0, totalTyped - errors);
        const accuracy = totalTyped > 0 ? Math.round((correctlyTyped / totalTyped) * 100) : 100;

        wpmDisplay.textContent = `WPM: ${currentWpm}`;
        accuracyDisplay.textContent = `Acc: ${accuracy}%`; // Abbreviated label
        errorsDisplay.textContent = `Errors: ${errors}`;
    }

    // updateBookProgress remains the same
    function updateBookProgress() {
        // Use cached/calculated chapterLengths and totalBookCharacters
        if (!bookLengthCalculated || !Array.isArray(chapterLengths) || chapterLengths.length === 0 || !spineItems || chapterLengths.length !== spineItems.length) {
            bookProgressDisplay.textContent = "Book: N/A";
            return;
        }

        // --- Calculate Total Words ---
        const totalBookWords = totalBookCharacters > 0 ? Math.max(1, Math.floor(totalBookCharacters / 5)) : 0;

        // --- Calculate Completed Characters (Overall Chapter Progress) ---
        // Start with progress from fully completed previous chapters
        let charsInCompletedChapters = 0;
        const chapterProgressMap = window.currentBookChapterProgress || {};
        for (let i = 0; i < currentChapterIndex; i++) {
            // Use saved progress if available and matches chapter length, otherwise use calculated length
             const savedChapProgress = chapterProgressMap[String(i)];
             const chapLen = chapterLengths[i] || 0;
             if (typeof savedChapProgress === 'number' && savedChapProgress >= chapLen) {
                 charsInCompletedChapters += chapLen; // Completed based on saved progress
             } else if (chapLen > 0) {
                // If not fully completed in savings, add the saved part
                 charsInCompletedChapters += (savedChapProgress > 0 ? savedChapProgress : 0);
             }
             // Note: This calculation might slightly differ from simply summing chapterLengths
             // if a chapter was partially done but not saved correctly before. Summing lengths is simpler:
             // charsInCompletedChapters += (chapterLengths[i] || 0); // Simpler approach
        }
         // --- Recalculate charsInCompletedChapters using simpler approach ---
         charsInCompletedChapters = 0;
         for (let i = 0; i < currentChapterIndex; i++) {
             charsInCompletedChapters += (chapterLengths[i] || 0);
         }
         // --- End Recalculate ---


        // Now add progress within the *current* chapter based on chunk state
        const progressInCurrentChapterChars = Math.max(0, chunkStartIndexInChapter + currentTypedIndexInChunk);

        // Clamp to the actual current chapter length
        const currentChapterTrueLength = chapterLengths[currentChapterIndex] || 0;
        const clampedProgressInCurrentChapter = Math.min(progressInCurrentChapterChars, currentChapterTrueLength);

        const currentPositionInBookChars = charsInCompletedChapters + clampedProgressInCurrentChapter;

        // --- Calculate Completed Words ---
        const completedWords = totalBookCharacters > 0 ? Math.floor(currentPositionInBookChars / 5) : 0;

        // --- Calculate Percentage ---
        const percentage = totalBookWords > 0 ? Math.round((completedWords / totalBookWords) * 100) : 0;

        // --- Update Display ---
        bookProgressDisplay.textContent = `Book: ${percentage}%`;
         // console.log(`Book Progress: ${completedWords}/${totalBookWords} words (${percentage}%)`);
    }


     function updateNavigation() {
        const hasChapters = spineItems && Array.isArray(spineItems) && spineItems.length > 0;
        if (hasChapters) {
            chapterInfoDisplay.textContent = `Ch: ${currentChapterIndex + 1}/${spineItems.length}`; // Shorter label
            prevChapterButton.disabled = isLoading || currentChapterIndex <= 0;
            nextChapterButton.disabled = isLoading || currentChapterIndex >= spineItems.length - 1;
        } else {
            chapterInfoDisplay.textContent = "Chapter: - / -";
            prevChapterButton.disabled = true;
            nextChapterButton.disabled = true;
        }
    }

     function setLoadingState(loading, message = "") {
        isLoading = loading;
        // Simple visual cue - maybe disable buttons is enough
         updateNavigation();
        // Optional: Add body class for more global styling
        document.body.classList.toggle('is-loading', loading);
        if (loading && !sourceTextArea.querySelector('span')) {
             sourceTextArea.innerHTML = `<p>${message || 'Loading...'}</p>`;
        }
     }


     function resetUI() {
        // Reset visual elements to defaults
        chapterInfoDisplay.textContent = "Chapter: - / -";
        bookProgressDisplay.textContent = "Book: 0%";
        prevChapterButton.disabled = true;
        nextChapterButton.disabled = true;
        resetStats(); // Reset WPM, Acc, Errors display

        // Update placeholder based ONLY on whether a previous file is known
        // currentFilename is set by loadLastOpenedFilePreference before this runs
        if (currentFilename) {
             // A filename exists - prompt user to re-select it
             sourceTextArea.innerHTML = `<p>Please re-select '<strong>${currentFilename}</strong>' to resume typing,<br>or choose a different EPUB file.</p>`;
        } else {
            // No filename known, show default prompt
             sourceTextArea.innerHTML = "<p>Please select an EPUB file to begin.</p>";
        }
        // DO NOT call loadProgress here. Progress is loaded ONLY in handleFileSelect.
        // Ensure navigation reflects the initial state (no chapter loaded yet)
        updateNavigation(); // Will disable buttons as spineItems is empty
   }

     function resetStats() {
         wpmDisplay.textContent = `WPM: 0`;
         accuracyDisplay.textContent = `Acc: 100%`; // Abbreviated
         errorsDisplay.textContent = `Errors: 0`;
     }

     function resetTypingStateForNewChapter() {
         // currentTypedIndex is set in loadChapter after this
         errors = 0;
         totalTyped = 0;
         startTime = null;
         initialCharIndexToLoad = 0;
         resetStats();
         console.log("Typing state reset for new chapter.");
     }

    function resetState(clearFileRelated = false) {
         book = null;
         spineItems = [];
         currentChapterIndex = 0;
         currentChapterText = "";
         totalBookCharacters = 0;
         chapterLengths = [];
         bookLengthCalculated = false; // <<< Reset cache flag

        resetTypingStateForNewChapter();

         if (clearFileRelated) {
             currentFilename = null;
             try { fileInput.value = ''; } catch (e) { /* ignore */ }
             // Don't clear LAST_OPENED_KEY automatically
             resetUI(); // Resets display fully
             sourceTextArea.innerHTML = "<p>Please select an EPUB file to begin.</p>";
         } else {
             // If keeping file, just update UI elements based on reset data
             updateNavigation();
             updateBookProgress();
         }
        console.log(`State reset invoked. Clear file related: ${clearFileRelated}`);
    }


    // --- Persistence (LocalStorage) ---

    function saveProgress() {
        if (!currentFilename || !spineItems || spineItems.length === 0) {
            return; // No file or structure loaded
        }

        const key = PROGRESS_KEY_PREFIX + currentFilename;
        let progressData = {};

        // Try to load existing data first to merge
        try {
            const existingData = localStorage.getItem(key);
            if (existingData) {
                progressData = JSON.parse(existingData);
            }
        } catch (e) {
            console.error("Error parsing existing progress data before saving:", e);
            progressData = {};
        }

        // Ensure chapterProgress object exists
        if (!progressData.chapterProgress) {
            progressData.chapterProgress = {};
        }

        // --- Calculate the OVERALL character index in the chapter ---
        // Start with the base index where the current chunk begins
        let overallChapterIndex = chunkStartIndexInChapter;
        // Add the progress within the current chunk
        overallChapterIndex += currentTypedIndexInChunk;

        // If the user is waiting for Enter/Space, the progress hasn't *passed* the break yet.
        // The 'currentTypedIndexInChunk' might point *at* the placeholder index.
        // We want to save the index *before* the break that requires action.
        if (currentTypedIndexInChunk > 0) {
            const precedingSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk - 1}`);
            if (precedingSpan?.classList.contains('needs-enter')) {
                // If needs enter, save the index of the char *before* the break.
                overallChapterIndex = chunkStartIndexInChapter + currentTypedIndexInChunk - 1;
                 console.log("saveProgress: Adjusting save index due to needs-enter state.");
            }
        }
        // --- End Calculation ---


        // Update the overall character index for the CURRENT chapter
        progressData.chapterProgress[String(currentChapterIndex)] = overallChapterIndex;
        // *** FIXED LOG MESSAGE ***
        console.log(`saveProgress: Updating chapter ${currentChapterIndex} to overall index ${overallChapterIndex}`);

        // Keep/Update existing book length data (logic remains same)
        if (bookLengthCalculated && !progressData.bookLengthData) {
             progressData.bookLengthData = { totalChars: totalBookCharacters, chapLengths: chapterLengths };
             console.log(`saveProgress: Adding bookLengthData.`);
        } else if (bookLengthCalculated && progressData.bookLengthData) {
             progressData.bookLengthData.totalChars = totalBookCharacters;
             progressData.bookLengthData.chapLengths = chapterLengths;
        }

        // Save the updated progress object
        try {
            localStorage.setItem(key, JSON.stringify(progressData));
        } catch (e) {
            console.error("Error saving progress:", e);
        }
    }

    function loadProgress() {
        // Reset state vars related to progress cache before loading
        totalBookCharacters = 0;
        chapterLengths = [];
        bookLengthCalculated = false; // Assume not loaded initially
        // Clear any previously loaded global chapter progress map if needed
        // (We'll load it fresh below if available)
        window.currentBookChapterProgress = {}; // Use a distinct global/window object

        // Ensure filename and spine are ready
        if (!currentFilename || !spineItems || spineItems.length === 0) {
            console.log("loadProgress SKIPPED: No filename or spineItems not ready.");
            return;
        }

        const key = PROGRESS_KEY_PREFIX + currentFilename;
        const savedData = localStorage.getItem(key);
        console.log(`loadProgress: Attempting to load book data for key: ${key}`);

        if (savedData) {
            try {
                const progressData = JSON.parse(savedData);
                console.log(`loadProgress: Found saved data:`, progressData);

                // --- Validate and load cached book length data ---
                if (progressData.bookLengthData &&
                    typeof progressData.bookLengthData.totalChars === 'number' &&
                    progressData.bookLengthData.totalChars >= 0 && // Allow 0 total chars
                    Array.isArray(progressData.bookLengthData.chapLengths) &&
                    progressData.bookLengthData.chapLengths.length === spineItems.length)
                {
                    totalBookCharacters = progressData.bookLengthData.totalChars;
                    chapterLengths = progressData.bookLengthData.chapLengths;
                    bookLengthCalculated = true; // Mark as loaded from cache
                    console.log(`loadProgress: Cached book length loaded: ${totalBookCharacters} chars, ${chapterLengths.length} chapters.`);
                } else {
                     console.log("loadProgress: Cached book length data not found or invalid.");
                     bookLengthCalculated = false; // Ensure flag is false if data is bad
                }

                // --- Load chapter progress map ---
                if (progressData.chapterProgress && typeof progressData.chapterProgress === 'object') {
                    window.currentBookChapterProgress = progressData.chapterProgress;
                    console.log(`loadProgress: Loaded chapter progress map:`, window.currentBookChapterProgress);
                } else {
                    console.log("loadProgress: No chapter progress map found in saved data.");
                    window.currentBookChapterProgress = {}; // Initialize empty map
                }

            } catch (e) {
                console.error("loadProgress: Error parsing saved progress:", e);
                // Reset everything if parsing fails
                totalBookCharacters = 0;
                chapterLengths = [];
                bookLengthCalculated = false;
                window.currentBookChapterProgress = {};
                // Optionally clear corrupted data?
                // clearProgress();
            }
        } else {
            console.log(`loadProgress: No saved progress found for ${currentFilename}. Starting fresh.`);
            // Ensure state is default if no progress found
            bookLengthCalculated = false;
            window.currentBookChapterProgress = {};
        }
         // Do NOT set global currentChapterIndex or initialCharIndexToLoad here.
         // updateNavigation/BookProgress are called later
    }


    function clearProgress(filename = currentFilename) {
        if (!filename) return;
        const key = PROGRESS_KEY_PREFIX + filename;
        try {
            localStorage.removeItem(key);
            console.log(`Cleared saved progress for ${filename}`);
        } catch (e) { console.error("Error removing progress from localStorage:", e); }
    }

    function markChapterAsCompletedUI() {
        // *** FIXED LOG MESSAGE ***
        console.log(`Marking Chapter ${currentChapterIndex + 1} UI (chunk ${currentChunkIndex}) as completed.`);

        // Use currentChunkText for iteration
        if (!currentChunkText) return;

        // Iterate through all characters IN THE CURRENT CHUNK and mark them as 'correct'
        for (let i = 0; i < currentChunkText.length; i++) {
            if (currentChunkText[i] === P_BREAK_PLACEHOLDER) continue;

            // *** FIXED SPAN ID PREFIX ***
            const charSpan = document.getElementById(`chunk-char-${i}`);
            if (charSpan) {
                charSpan.classList.remove('incorrect', 'current', 'needs-enter');
                charSpan.classList.add('correct');
            }
        }
        // Ensure the cursor ('current' class) is not shown after marking complete
        const previousChar = sourceTextArea.querySelector('span.current');
        if (previousChar) previousChar.classList.remove('current');

        // Optional: Scroll to the end
        textDisplayArea.scrollTo({ top: textDisplayArea.scrollHeight, behavior: 'auto' });
    }

    function loadChunk(chunkIndex, initialOffset = 0) {
        if (chunkIndex < 0 || chunkIndex >= chapterChunks.length) {
            // Handle edge cases like empty chapter resulting in no chunks
            if (chapterChunks.length === 0) {
                console.log("loadChunk: No chunks available (chapter likely empty).");
                currentChunkIndex = 0;
                currentChunkText = "";
                currentTypedIndexInChunk = 0;
                chunkStartIndexInChapter = 0;
                displayChunkText(); // Display empty state
                updateNavigation(); // Update chapter nav potentially
                // updateChunkNavigation(); // Update chunk nav if you add it
                updateBookProgress(); // Update book progress
                markChapterAsCompletedUI(); // Mark empty chapter as complete
                return; // Exit
            } else {
                console.warn(`loadChunk: Invalid chunk index ${chunkIndex} requested. Clamping or ignoring.`);
                // Optionally clamp or return, for now let's just log and potentially return
                return; // Or clamp: chunkIndex = Math.max(0, Math.min(chunkIndex, chapterChunks.length - 1));
            }
        }

        console.log(`loadChunk: Loading chunk ${chunkIndex} with initial offset ${initialOffset}`);
        currentChunkIndex = chunkIndex;

        // --- Calculate start index of this chunk in the original chapter text ---
        let calculatedStartIndex = 0;
        for (let i = 0; i < currentChunkIndex; i++) {
            // Calculate length of previous chunks accurately
             const chunkParas = chapterChunks[i];
             if (chunkParas && chunkParas.length > 0) {
                 let chunkLength = chunkParas[0].length; // First para
                 for (let j = 1; j < chunkParas.length; j++) {
                     chunkLength += 1 + chunkParas[j].length; // +1 for placeholder
                 }
                 calculatedStartIndex += chunkLength + 1; // +1 for placeholder separating chunks
             }
        }
        chunkStartIndexInChapter = calculatedStartIndex;
        console.log(`loadChunk: Calculated chunk start index in chapter: ${chunkStartIndexInChapter}`);
        // --- End Calculate start index ---

        // Join paragraphs for the current chunk
        const currentParas = chapterChunks[currentChunkIndex];
        // Join with placeholder, but DON'T add one at the very end
        currentChunkText = currentParas.join(P_BREAK_PLACEHOLDER);

        console.log(`loadChunk: Chunk text length: ${currentChunkText.length}`);

        // --- Set initial typing position within the chunk ---
        // Clamp the offset to be within the chunk's bounds [0, length]
        currentTypedIndexInChunk = Math.max(0, Math.min(initialOffset, currentChunkText.length));
        console.log(`loadChunk: Setting currentTypedIndexInChunk to ${currentTypedIndexInChunk}`);

        // Reset typing stats for the new chunk (errors, timer maybe?)
        resetTypingStateForNewChunk(); // New function needed

        // Display the chunk text
        displayChunkText(); // Modified display function

        // --- Restore Visual State for the loaded chunk ---
        console.log(`loadChunk: Restoring visual state up to index ${currentTypedIndexInChunk} in chunk.`);
        for (let i = 0; i < currentTypedIndexInChunk; i++) {
            if (currentChunkText[i] !== P_BREAK_PLACEHOLDER) {
                const charSpan = document.getElementById(`chunk-char-${i}`); // Use new ID prefix
                if (charSpan) {
                    charSpan.classList.remove('incorrect', 'current', 'needs-enter');
                    charSpan.classList.add('correct');
                }
            }
        }
         // Check if the character *just before* the current index requires 'needs-enter'
         if (currentTypedIndexInChunk > 0 && currentTypedIndexInChunk <= currentChunkText.length) {
             const nextCharIsBreak = currentChunkText[currentTypedIndexInChunk] === P_BREAK_PLACEHOLDER;
             // Need to check the character *before* the potential break
             const prevCharIndex = currentTypedIndexInChunk - 1;
             if (nextCharIsBreak && prevCharIndex >= 0) {
                 const prevCharSpan = document.getElementById(`chunk-char-${prevCharIndex}`);
                 if (prevCharSpan) {
                     prevCharSpan.classList.add('needs-enter');
                     console.log(`loadChunk: Restored needs-enter state for chunk index ${prevCharIndex}`);
                 }
             }
         }
        // --- End Restore Visual State ---

        // --- Update UI ---
        updateStats(); // Update WPM/Acc (will reset)
        updateNavigation(); // Update chapter Prev/Next buttons
        // updateChunkNavigation(); // TODO: Add specific chunk nav UI if desired
        updateBookProgress(); // Reflects progress based on current chunk/pos
        updateCursor(); // Position cursor within the chunk

        // Focus input if there's text to type
        if (currentTypedIndexInChunk < currentChunkText.length) {
             try { hiddenInput.focus(); } catch(e) { console.warn("Focus failed", e); }
        } else {
             console.log("loadChunk: Chunk loaded at completed state.");
             // Potentially check if it's the last chunk and auto-advance chapter? (Handled in handleKeyDown now)
        }
    }
    function resetTypingStateForNewChunk() {
        // Reset stats relevant to a typing session within a chunk
        errors = 0;
        totalTyped = 0; // Reset words/chars typed for this chunk's WPM calc
        startTime = null; // Reset timer for the new chunk
        resetStats(); // Update display WPM=0, Acc=100%, Errors=0
        console.log("Typing state reset for new chunk.");
    }
    function displayChunkText() {
        // Uses global currentChunkText
        if (currentChunkText == null) { // Should ideally not be null if loadChunk worked
             sourceTextArea.innerHTML = "<p style='color: red;'>Error: Chunk text unavailable.</p>";
             return;
         }

        // --- Render spans based on CHUNK text ---
        const htmlContent = currentChunkText
            .split('')
            .map((char, index) => {
                if (char === P_BREAK_PLACEHOLDER) {
                    // Output double line breaks for the placeholder
                    return '<br><br>';
                } else {
                    // Use chunk-specific ID prefix
                    const displayChar = char; // Use char directly
                    return `<span id="chunk-char-${index}">${displayChar}</span>`;
                }
            })
            .join('');
        // --- END SPAN MAPPING ---

        sourceTextArea.innerHTML = htmlContent;

        console.log("Chunk text rendered.");

        if (currentChunkText.length === 0 || sourceTextArea.innerHTML === '') {
             sourceTextArea.innerHTML = "<p>(Chunk appears empty)</p>";
        }
    }

    function navigateChunk(direction) {
        if (isLoading) return; // Don't navigate while loading

        const newChunkIndex = currentChunkIndex + direction;

        // --- Check for Chapter Boundaries ---
        if (direction === 1) { // Right Arrow
            // Check if we are on the LAST chunk AND at/past the end of its text
            if (currentChunkIndex >= chapterChunks.length - 1 &&
                currentTypedIndexInChunk >= currentChunkText.length)
            {
                console.log("navigateChunk: At end of last chunk, attempting to navigate to next chapter.");
                navigateChapter(1); // Call the function to move to the next chapter
                return; // Stop further processing in this function
            }
        } else if (direction === -1) { // Left Arrow
            // Check if we are on the FIRST chunk
            if (currentChunkIndex <= 0) {
                 // Optional Check: only navigate if at the very beginning of the first chunk?
                 // if (currentTypedIndexInChunk === 0) {
                    console.log("navigateChunk: At start of first chunk, attempting to navigate to previous chapter.");
                    navigateChapter(-1); // Call the function to move to the previous chapter
                    return; // Stop further processing
                 // }
            }
        }
        // --- End Chapter Boundary Check ---


        // --- Normal Chunk Navigation (within the same chapter) ---
        if (newChunkIndex >= 0 && newChunkIndex < chapterChunks.length) {
            console.log(`Navigating chunk from ${currentChunkIndex} to ${newChunkIndex}`);
            // Save progress for the chunk we are leaving (based on its state)
            saveProgress();
            // Load the new chunk (start at beginning for arrow nav)
            loadChunk(newChunkIndex, 0);
        } else {
             console.log(`Chunk navigation blocked: Index ${newChunkIndex} out of bounds [0, ${chapterChunks.length - 1}]`);
             // Optionally flash UI or provide feedback
        }
    }


}); // End DOMContentLoaded

