      
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
    let chapterChunks = []; // Array of paragraph arrays [[p1, p2,...], [p7, p8,...]]
    let currentChunkIndex = 0;
    let currentChunkText = ""; // The text content of the current chunk
    let currentTypedIndexInChunk = 0; // Typing index WITHIN the current chunk
    let chunkStartIndexInChapter = 0; // Character index where the current chunk starts in the ORIGINAL chapter text

    // Chunking State
    const CHUNK_SIZE = 6; // Number of paragraphs per chunk
    
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
        const expectedFilename = currentFilename; // Store potentially remembered filename

        // Validation...
        if (isLoading || !file || !file.name.endsWith('.epub')) {
            if (file && !file.name.endsWith('.epub')) { alert("Please select a valid .epub file."); }
            else if (!file) { console.log("No file selected."); }
            if (isLoading) { console.log("handleFileSelect: Aborted because isLoading is true."); }
            try { fileInput.value = ''; } catch(e) { console.warn("Couldn't clear file input");}
            return;
         }

        const selectedFilename = file.name;
        let chapterIndexToLoad = 0; // Default start chapter, will be updated by loadProgress

        // --- Check if selected file is DIFFERENT ---
        if (expectedFilename && selectedFilename !== expectedFilename) {
            console.log(`Selected file '${selectedFilename}' differs from expected '${expectedFilename}'. Resetting application state for new book.`);
            // *** Optional: Decide if you want to clear OLD progress ***
            // clearProgress(expectedFilename); // Keep commented out to preserve old book data
            resetState(true); // Full reset of in-memory state, clears currentFilename
            currentFilename = selectedFilename; // Set to the NEW selected filename
            console.log("handleFileSelect: State reset for new file selection.");
        } else if (!expectedFilename) {
             // No previous file expected (e.g., first ever load)
             currentFilename = selectedFilename;
             resetState(false); // Basic reset (keep filename, reset typing state)
        } else {
            // Filename matches (likely re-selection after refresh)
             console.log(`handleFileSelect: Re-selected same file '${currentFilename}'. Resetting typing state.`);
             resetState(false); // Keep filename, reset typing state
        }
        // --- End Check ---

        console.log(`handleFileSelect: Starting load for ${currentFilename}`);
        setLoadingState(true, "Loading EPUB...");
        const reader = new FileReader();

        reader.onload = async (e) => {
            console.log(`handleFileSelect: reader.onload started for ${currentFilename}.`);
            const arrayBuffer = e.target.result;
            try {
                book = ePub(arrayBuffer); await book.ready; await book.spine.ready;
                spineItems = book.spine.spineItems; if (!spineItems || spineItems.length === 0) { throw new Error("Invalid EPUB spine data"); }
                console.log(`handleFileSelect: Spine ready for ${currentFilename}, found ${spineItems.length} items.`);

                // --- Load progress AND determine starting chapter ---
                // loadProgress now returns the chapter index to start on
                chapterIndexToLoad = loadProgress(); // Reads localStorage based on currentFilename
                console.log(`handleFileSelect: loadProgress finished. Determined chapter index to load: ${chapterIndexToLoad}`);

                // --- Calculate/Use Cached Length FOR THE CURRENT FILE ---
                if (!bookLengthCalculated) {
                     console.log(`handleFileSelect: Calculating book length for ${currentFilename}...`);
                     await calculateTotalBookCharacters();
                     console.log(`handleFileSelect: Book length calculation finished.`);
                 }
                else { console.log("handleFileSelect: Using cached book length data."); updateBookProgress(); }

                // --- Save Preferences & Load Determined Chapter ---
                localStorage.setItem(LAST_OPENED_KEY, currentFilename); // Remember this book as last opened
                setLoadingState(false); // Set loading false *before* potentially long chapter load

                // *** Use the determined chapter index ***
                console.log(`handleFileSelect: Calling loadChapter(${chapterIndexToLoad}) for initial load.`);
                // Update the global state variable *before* calling loadChapter
                currentChapterIndex = chapterIndexToLoad;
                await loadChapter(currentChapterIndex); // Load the target chapter

                console.log(`handleFileSelect: loadChapter call finished for chapter ${currentChapterIndex}.`);
                // No immediate save needed here, save happens on interaction

            } catch (err) { /* ... error handling ... */
                 console.error(`handleFileSelect: Error processing EPUB ${currentFilename}:`, err);
                 alert(`Could not load or parse the EPUB file: ${err.message || 'Unknown error'}`);
                 resetState(true); resetUI(); setLoadingState(false);
             }
        };
        reader.onerror = () => { /* ... error handling ... */
             console.error("Error reading file."); alert('Error reading file.');
             resetState(true); resetUI(); setLoadingState(false);
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
                        .replace(/…/g, '...') // Ellipsis (U+2026)
                        .replace(/\r\n/g, '\n') // Standardize line endings
                        .replace(/ /g, ' ') // Handle non-breaking spaces
                        .replace(/(\s|^)(\d+\.\d+)\s+([A-Z])/g, `$1${P_BREAK_PLACEHOLDER}$2 $3`) // Headers
                        .replace(/\n{2,}/g, P_BREAK_PLACEHOLDER) // Double newlines
                        .replace(/\n/g, ' ') // Single newlines
                        .replace(/—/g, ' - ') // Em dash
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
                .replace(/…/g, '...') // Ellipsis (U+2026)
                .replace(/\r\n/g, '\n') // Standardize line endings
                .replace(/ /g, ' ') // Handle non-breaking spaces
                .replace(/(\s|^)(\d+\.\d+)\s+([A-Z])/g, `$1${P_BREAK_PLACEHOLDER}$2 $3`) // Headers
                .replace(/\n{2,}/g, P_BREAK_PLACEHOLDER) // Double newlines
                .replace(/\n/g, ' ') // Single newlines
                .replace(/—/g, ' - ') // Em dash
                .replace(/[“”]/g, '"') // Smart quotes
                .replace(/[‘’]/g, "'") // Smart quotes
                .replace(/©/g, 'c') // Copyright symbol
                .replace(/\s+/g, ' ') // Collapse multiple spaces
                .replace(new RegExp(`${P_BREAK_PLACEHOLDER}\\s+`, 'g'), P_BREAK_PLACEHOLDER) // Space after break
                .replace(new RegExp(`[${P_BREAK_PLACEHOLDER}\\s]+\\s*(\\d+\\.\\d+)`, 'g'), '$1') // Break/space before header
                .replace(new RegExp(`^[${P_BREAK_PLACEHOLDER}\\s]+|[${P_BREAK_PLACEHOLDER}\\s]+$`, 'g'), ''); // Trim breaks/spaces
            // --- END NORMALIZE ---

            // Set the full chapter text (still needed for calculations)
            currentChapterText = rawText;
            console.log(`loadChapter(${chapterIndex}): Full chapter text processed. Length: ${currentChapterText.length} chars.`);

            // --- Optional: Validate/Update Chapter Length Cache ---
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


            // --- Determine Initial Chunk (Index only) ---
            // Offset calculation is now done inside loadChunk based on latest localStorage
            let initialChunkIndex = 0;
            if (overallSavedCharIndex > 0 && chapterChunks.length > 0) {
                 let charCount = 0;
                 for (let i = 0; i < chapterChunks.length; i++) {
                     const chunkParas = chapterChunks[i];
                     let currentChunkLength = 0;
                     if (chunkParas && chunkParas.length > 0) {
                         currentChunkLength = chunkParas[0].length;
                         for (let j = 1; j < chunkParas.length; j++) { currentChunkLength += 1 + chunkParas[j].length; }
                     }

                     // If saved index is BEFORE the end of this chunk OR exactly at the end
                     if (overallSavedCharIndex <= charCount + currentChunkLength) {
                         initialChunkIndex = i;
                         break; // Found the chunk where the saved index falls
                     }
                      // Check if saved index is exactly at the start of the NEXT chunk
                      else if (overallSavedCharIndex === charCount + currentChunkLength + 1 && i < chapterChunks.length - 1) {
                         initialChunkIndex = i + 1;
                         break; // Start at the beginning of the next chunk
                      }

                     charCount += currentChunkLength + 1; // Move to the start of the next potential chunk

                      // If loop finishes, index is likely past the end, target last chunk
                      if (i === chapterChunks.length - 1) {
                           initialChunkIndex = i; // Target the last chunk
                           console.warn(`Saved index ${overallSavedCharIndex} seems beyond chapter end. Loading last chunk.`);
                      }
                 }
            }
             console.log(`loadChapter: Determined initial chunk: ${initialChunkIndex}`);
            // --- End Initial Chunk Determination ---

            // Load the determined chunk - loadChunk will calculate the offset
            loadChunk(initialChunkIndex); // No offset passed

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
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            event.preventDefault();
            navigateChunk(key === 'ArrowRight' ? 1 : -1);
            return;
        }
        // --- End Arrow Key Navigation ---

        // --- Check if current chunk is loaded as complete/read-only ---
        const isChunkReadOnly = sourceTextArea.dataset.readonly === 'true';

        // Block non-navigation keys if read-only
        if (isChunkReadOnly && !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) {
             // Allow backspace *only if* cursor is beyond the actual content end
             // (e.g., if needs-enter was active at the very end and index > length)
             if (key === 'Backspace' && currentTypedIndexInChunk >= currentChunkText.length) {
                  console.log("Allowing backspace at end of read-only chunk potentially for needs-enter cleanup.");
             } else {
                  console.log(`Key [${key}] blocked: Chunk is loaded as complete/read-only.`);
                  event.preventDefault(); // Prevent default action for blocked keys too
                  return; // Block keys like letters, space, enter, backspace (within text)
             }
        }
        // --- End Read-only check ---


        // Allow backspace even if technically "finished" (for needs-enter cleanup)
        if (currentTypedIndexInChunk >= currentChunkText.length && key !== 'Backspace') {
             let lastCharNeedsEnter = false;
             if (currentTypedIndexInChunk > 0) { /* ... check needs-enter ... */
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
        if (key === ' ' || key === 'Backspace' || key === 'Enter') { event.preventDefault(); }

        // Ignore other non-typing keys
        if (key.length > 1 && key !== 'Backspace' && key !== 'Enter' && !isCtrlBackspace) {
             console.log("handleKeyDown ignored: Non-typing helper key:", key);
             return;
        }

        // --- Handle Backspace (operates on chunk) ---
        if (key === 'Backspace') {
            event.preventDefault(); // Ensure it's prevented

             // Re-check read-only state specifically for backspace action itself within text
             if (isChunkReadOnly && currentTypedIndexInChunk < currentChunkText.length) {
                  console.log("Backspace action blocked: Chunk is read-only.");
                  return;
             }

            let performSave = false; // Flag to save only if index actually changes

            if (isCtrlBackspace) {
                if (currentTypedIndexInChunk > 0) { // Only if not at start
                    const originalIndex = currentTypedIndexInChunk;
                    let targetIndex = currentTypedIndexInChunk - 1;
                    // Skip trailing spaces
                    while (targetIndex >= 0 && /\s/.test(currentChunkText[targetIndex])) { targetIndex--; }
                    // Find start of word (or placeholder)
                    while (targetIndex >= 0 && !/\s/.test(currentChunkText[targetIndex]) && currentChunkText[targetIndex] !== P_BREAK_PLACEHOLDER) { targetIndex--; }
                    const newIndex = targetIndex + 1; // Land after the space/placeholder/start

                    if (newIndex < originalIndex) { // Check if index changed
                        for (let i = newIndex; i < originalIndex; i++) { /* ... clear styles ... */
                            if (currentChunkText[i] === P_BREAK_PLACEHOLDER) continue;
                            const charSpan = document.getElementById(`chunk-char-${i}`);
                            if (charSpan) {
                                if (charSpan.classList.contains('incorrect')) { errors = Math.max(0, errors - 1); }
                                charSpan.classList.remove('correct', 'incorrect', 'current', 'needs-enter');
                            }
                        }
                        currentTypedIndexInChunk = newIndex;
                        performSave = true; // Index changed, need to save
                    }
                }
            } else { // Regular Backspace
                if (currentTypedIndexInChunk > 0) {
                     const indexToClear = currentTypedIndexInChunk - 1;
                     currentTypedIndexInChunk--; // Move index back first

                    const charSpan = document.getElementById(`chunk-char-${indexToClear}`);
                    if (charSpan) { /* ... clear styles ... */
                        if (charSpan.classList.contains('incorrect')) { errors = Math.max(0, errors - 1); }
                        charSpan.classList.remove('correct', 'incorrect', 'current', 'needs-enter');
                        console.log(`Backspace cleared style from chunk index ${indexToClear}`);
                    }
                     if(currentTypedIndexInChunk > 0) { /* ... clear preceding needs-enter ... */
                          const newPrecedingSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk - 1}`);
                          if (newPrecedingSpan?.classList.contains('needs-enter')) {
                               newPrecedingSpan.classList.remove('needs-enter');
                               console.log(`Backspace removed needs-enter from chunk index ${currentTypedIndexInChunk - 1}`);
                          }
                     }
                    if (currentTypedIndexInChunk === 0 && totalTyped <= 1) { /* ... reset timer ... */
                         startTime = null; totalTyped = 0; console.log("Timer reset...");
                    }
                    performSave = true; // Index changed, need to save
                }
            }

            // Update UI after any backspace action
            updateCursor();
            updateStats();
            updateBookProgress();
            if (performSave) {
                saveProgress(); // Save ONLY if index actually changed
            }
            return; // Stop after handling backspace
        } // End Backspace Handling


        // --- Handle Typing / Enter / Space Key ---
        let needsEnter = false;
        let precedingSpan = null;
        if (currentTypedIndexInChunk > 0) { /* ... check needs-enter ... */
             precedingSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk - 1}`);
             needsEnter = precedingSpan?.classList.contains('needs-enter') ?? false;
        }
        const expectedChar = (currentTypedIndexInChunk < currentChunkText.length) ? currentChunkText[currentTypedIndexInChunk] : null;

        // --- Case 1: NEEDS Enter/Space ---
        if (needsEnter) {
            if (key === 'Enter' || key === ' ') { /* ... handle correct Enter/Space ... */
                console.log(`Key '${key}' pressed correctly at needs-enter point after chunk index ${currentTypedIndexInChunk - 1}.`);
                if (precedingSpan) { precedingSpan.classList.remove('incorrect', 'needs-enter'); precedingSpan.classList.add('correct'); }
                if (!startTime && totalTyped === 0) startTime = new Date();
                while (currentTypedIndexInChunk < currentChunkText.length && currentChunkText[currentTypedIndexInChunk] === P_BREAK_PLACEHOLDER) {
                     console.log(`handleKeyDown: Skipping placeholder at chunk index ${currentTypedIndexInChunk} after correct Enter/Space.`);
                    currentTypedIndexInChunk++;
                }
                updateCursor(); updateStats(); updateBookProgress(); saveProgress();
                return;
            } else { /* ... handle incorrect key ... */
                console.log(`Incorrect key '${key}' pressed at needs-enter point.`);
                 if (precedingSpan && !precedingSpan.classList.contains('incorrect')) { errors++; precedingSpan.classList.add('incorrect'); precedingSpan.classList.remove('correct'); updateStats(); }
                 if (precedingSpan) precedingSpan.classList.add('needs-enter');
                 return;
            }
        }
        // --- End Case 1 ---

        // --- Case 2: Regular Typing ---
        if (key === 'Enter') { console.log("Enter ignored."); return; } // Ignore Enter if not needed
        if (expectedChar === null) { console.log("At end of chunk, ignoring non-backspace/nav keys."); return; } // At end of chunk
        if (expectedChar === P_BREAK_PLACEHOLDER) { console.error(`Logic Error: Attempting to type at placeholder chunk index ${currentTypedIndexInChunk}.`); return; } // Safeguard

        if (key.length === 1) { /* ... handle regular char typing ... */
            const typedChar = key;
            const charSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk}`);
            if (!charSpan) { console.error(`Chunk span not found: index ${currentTypedIndexInChunk}`); return; }
            if (!startTime) startTime = new Date();
            let correct = false;
            // Correctness check
             const isExpectedSpace = (expectedChar === ' ' || expectedChar === '\u00A0');
             const isTypedSpace = (typedChar === ' ');
             if ((isTypedSpace && isExpectedSpace) || (!isExpectedSpace && typedChar === expectedChar)) {
                 correct = true; charSpan.classList.add('correct'); charSpan.classList.remove('incorrect', 'current', 'needs-enter');
             } else {
                 correct = false; if (!charSpan.classList.contains('incorrect')) { errors++; } charSpan.classList.add('incorrect'); charSpan.classList.remove('correct', 'current', 'needs-enter');
             }
            totalTyped++;
            const processedChunkIndex = currentTypedIndexInChunk;
            currentTypedIndexInChunk++;

            // Check for next break
             let nextCharIsBreak = (currentTypedIndexInChunk < currentChunkText.length && currentChunkText[currentTypedIndexInChunk] === P_BREAK_PLACEHOLDER);
             if (nextCharIsBreak) {
                 console.log(`Next char at chunk index ${currentTypedIndexInChunk} is a break.`);
                 const spanToMark = document.getElementById(`chunk-char-${processedChunkIndex}`);
                 if (spanToMark) { if(correct) { spanToMark.classList.add('needs-enter'); } else { spanToMark.classList.remove('needs-enter'); } }
             }

            updateCursor(); updateStats(); updateBookProgress(); saveProgress();

            // Check for Chunk Completion & Auto-Advance
             if (currentTypedIndexInChunk >= currentChunkText.length && !nextCharIsBreak) {
                 console.log(`Completed chunk ${currentChunkIndex}.`);
                 if (currentChunkIndex < chapterChunks.length - 1) {
                     console.log("Auto-advancing to next chunk...");
                     setTimeout(() => navigateChunk(1), 100);
                 } else {
                     console.log("Last chunk of the chapter completed.");
                     markChapterAsCompletedUI();
                     // Optional: Auto-advance chapter
                     // setTimeout(() => navigateChapter(1), 200);
                 }
             }
            return;
        }
        // --- End Case 2 ---

        console.log("handleKeyDown: Unhandled key:", key);
   } // End handleKeyDown





   function navigateChapter(direction) {
    if (isLoading || !spineItems || spineItems.length === 0) return;
    const newIndex = currentChapterIndex + direction;
    if (newIndex >= 0 && newIndex < spineItems.length) {
        console.log(`Navigating chapter from ${currentChapterIndex} to ${newIndex}`);
        // *** SAVE progress for the chapter we are LEAVING ***
        saveProgress();
        // Load the new chapter (it will handle resetting chunk state etc.)
        loadChapter(newIndex);
    }
    }

    // --- Utility Functions ---

    function updateCursor() {
        // 1. Remove cursor from previous position
        const previousChar = sourceTextArea.querySelector('span.current');
        if (previousChar) previousChar.classList.remove('current');

        // 2. Determine the target index for the cursor
        const targetIndexInChunk = currentTypedIndexInChunk;

        // 3. Check if the target index is within the bounds
        if (currentChunkText && targetIndexInChunk < currentChunkText.length) {
            const targetSpan = document.getElementById(`chunk-char-${targetIndexInChunk}`);

            if (targetSpan) {
                // 4. Add the 'current' class
                targetSpan.classList.add('current');

                // 5. --- PROACTIVE Scrolling Logic ---
                try {
                    const areaRect = textDisplayArea.getBoundingClientRect();
                    const spanRect = targetSpan.getBoundingClientRect();
                    const areaHeight = textDisplayArea.clientHeight; // Use clientHeight for visible area

                    // Define scroll trigger zones (e.g., top/bottom 30% of the area)
                    const scrollThresholdRatio = 0.45; // Adjust this (0.25 = quarter, 0.33 = third)
                    const topThreshold = areaRect.top + (areaHeight * scrollThresholdRatio);
                    const bottomThreshold = areaRect.bottom - (areaHeight * scrollThresholdRatio);

                    // Check if the span's TOP is above the top threshold OR
                    // Check if the span's BOTTOM is below the bottom threshold
                    if (spanRect.top < topThreshold || spanRect.bottom > bottomThreshold) {
                        // Calculate target scroll position to center the span
                        // Use offsetTop relative to the scroll container (textDisplayArea)
                        const spanTopOffset = targetSpan.offsetTop;
                        const targetScrollTop = spanTopOffset - (areaHeight / 2) + (targetSpan.offsetHeight / 2);

                        // Scroll smoothly
                        textDisplayArea.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
                         console.log(`updateCursor: Scrolling to center span ${targetIndexInChunk}`); // Log scroll action
                    }
                } catch (e) {
                    console.warn("Proactive center scrolling failed:", e);
                    // Basic fallback
                    try { targetSpan.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
                }
                // --- End Scrolling Logic ---

            } else {
                console.warn(`updateCursor: Chunk span not found for index ${targetIndexInChunk}.`);
            }
        } else if (currentChunkText) {
            // 6. Handle end of chunk text
            console.log("updateCursor: Index is at or beyond end of chunk text.");
            if (targetIndexInChunk > 0) {
                const lastCharSpan = document.getElementById(`chunk-char-${targetIndexInChunk - 1}`);
                 if(lastCharSpan?.classList.contains('needs-enter')) {
                      lastCharSpan.classList.add('current'); // Keep cursor on last char if needs enter
                      try { lastCharSpan.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
                      return;
                 }
            }
            // Scroll to bottom if truly finished
            textDisplayArea.scrollTop = textDisplayArea.scrollHeight;
        } else {
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
        let existingOverallIndex = 0; // Default to 0 if not found

        // Try to load existing data first to merge AND get current saved index
        try {
            const existingData = localStorage.getItem(key);
            if (existingData) {
                progressData = JSON.parse(existingData);
                // Get the currently saved index for this chapter, if it exists
                if (progressData.chapterProgress && typeof progressData.chapterProgress[String(currentChapterIndex)] === 'number') {
                    existingOverallIndex = progressData.chapterProgress[String(currentChapterIndex)];
                }
            }
        } catch (e) {
            console.error("Error parsing existing progress data before saving:", e);
            progressData = {}; // Start fresh if parsing fails
            existingOverallIndex = 0; // Reset on parse error
        }

        // Ensure chapterProgress object exists
        if (!progressData.chapterProgress) {
            progressData.chapterProgress = {};
        }

        // --- Calculate the potential NEW overall character index ---
        let newOverallChapterIndex = chunkStartIndexInChapter + currentTypedIndexInChunk;

        // Adjust if waiting for enter BEFORE the current index
        if (currentTypedIndexInChunk > 0) {
            const precedingSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk - 1}`);
            if (precedingSpan?.classList.contains('needs-enter')) {
                newOverallChapterIndex = chunkStartIndexInChapter + currentTypedIndexInChunk - 1;
                // Log adjustment only if it happens
                // console.log("saveProgress: Adjusting potential save index due to needs-enter state.");
            }
        }
        // --- End Calculation ---

        // *** CRITICAL FIX: Only update if new index is greater than OR EQUAL TO existing ***
        // We use >= because if the user saves at the exact same spot, it's harmless and reflects current state.
        if (newOverallChapterIndex >= existingOverallIndex) {
            // Update the overall character index for the CURRENT chapter
            progressData.chapterProgress[String(currentChapterIndex)] = newOverallChapterIndex;
            // Only log if the value actually changes or is initially set
            if (newOverallChapterIndex !== existingOverallIndex || !progressData.chapterProgress.hasOwnProperty(String(currentChapterIndex))) {
                 console.log(`saveProgress: Updating chapter ${currentChapterIndex} from ${existingOverallIndex} to new overall index ${newOverallChapterIndex}`);
            }
        } else {
            // Log if we are *not* saving because the new index is smaller (due to backward nav state rendering)
            console.log(`saveProgress: Skipping update for chapter ${currentChapterIndex}. New index ${newOverallChapterIndex} is not greater than existing ${existingOverallIndex}.`);
            // IMPORTANT: Ensure the existing higher value remains in the object being saved if no update occurs
            // This line might be redundant if progressData was loaded correctly, but ensures safety.
            progressData.chapterProgress[String(currentChapterIndex)] = existingOverallIndex;
        }


        // Keep/Update existing book length data (logic remains same)
        if (bookLengthCalculated && (!progressData.bookLengthData || progressData.bookLengthData.chapLengths?.length !== chapterLengths.length)) {
             progressData.bookLengthData = { totalChars: totalBookCharacters, chapLengths: chapterLengths };
             console.log(`saveProgress: Adding/Updating bookLengthData.`);
        } else if (bookLengthCalculated && progressData.bookLengthData) {
             progressData.bookLengthData.totalChars = totalBookCharacters;
             progressData.bookLengthData.chapLengths = chapterLengths;
        }

        // Save the progress object (either updated or kept same)
        try {
            localStorage.setItem(key, JSON.stringify(progressData));
        } catch (e) {
            console.error("Error saving progress:", e);
        }
    }

    function loadProgress() {
        // Reset state vars related to the book being loaded
        totalBookCharacters = 0;
        chapterLengths = [];
        bookLengthCalculated = false;
        window.currentBookChapterProgress = {}; // Reset in-memory map for safety
        let lastChapterIndex = 0; // Default starting chapter if no progress found
        let maxOverallIndex = -1; // Track the highest saved index to find the last point

        // Ensure filename and spine are ready for THIS book
        if (!currentFilename || !spineItems || spineItems.length === 0) {
            console.log("loadProgress: Skipped - No filename or spineItems not ready.");
            return lastChapterIndex; // Return default chapter 0
        }

        const key = PROGRESS_KEY_PREFIX + currentFilename;
        const savedData = localStorage.getItem(key);
        console.log(`loadProgress [${currentFilename}]: Attempting to load book data for key: ${key}`);

        if (savedData) {
            try {
                const progressData = JSON.parse(savedData);
                console.log(`loadProgress [${currentFilename}]: Found saved data:`, progressData);

                // Load cached book length data for THIS book
                if (progressData.bookLengthData &&
                    typeof progressData.bookLengthData.totalChars === 'number' &&
                    progressData.bookLengthData.totalChars >= 0 &&
                    Array.isArray(progressData.bookLengthData.chapLengths) &&
                    progressData.bookLengthData.chapLengths.length === spineItems.length)
                {
                    totalBookCharacters = progressData.bookLengthData.totalChars;
                    chapterLengths = progressData.bookLengthData.chapLengths;
                    bookLengthCalculated = true;
                    console.log(`loadProgress [${currentFilename}]: Cached book length loaded: ${totalBookCharacters} chars, ${chapterLengths.length} chapters.`);
                } else {
                     console.log(`loadProgress [${currentFilename}]: Cached book length data not found/invalid.`);
                     bookLengthCalculated = false;
                }

                // Load chapter progress map AND find the last chapter worked on
                if (progressData.chapterProgress && typeof progressData.chapterProgress === 'object') {
                    window.currentBookChapterProgress = progressData.chapterProgress; // Store map in memory
                    console.log(`loadProgress [${currentFilename}]: Loaded chapter progress map into memory.`);

                    // --- Find the chapter with the highest saved index ---
                    for (const chapIdxStr in progressData.chapterProgress) {
                         // Ensure it's a direct property and not from prototype chain
                         if (Object.prototype.hasOwnProperty.call(progressData.chapterProgress, chapIdxStr)) {
                            const chapIdx = parseInt(chapIdxStr, 10);
                            const overallIndex = progressData.chapterProgress[chapIdxStr];

                            // Check if this index is valid and higher than current max
                            if (!isNaN(chapIdx) && typeof overallIndex === 'number' && overallIndex >= 0) { // Check index >= 0
                                 // Ensure chapter index is within the bounds of the currently loaded spine
                                 if (chapIdx >= 0 && chapIdx < spineItems.length) {
                                     // Use >= to handle multiple chapters saved at index 0 correctly
                                     if (overallIndex >= maxOverallIndex) {
                                         // If indices are equal, prefer the higher chapter number
                                         if (overallIndex > maxOverallIndex || chapIdx > lastChapterIndex) {
                                             maxOverallIndex = overallIndex;
                                             lastChapterIndex = chapIdx;
                                         }
                                     }
                                 } else {
                                      console.warn(`loadProgress: Found saved progress for chapter ${chapIdx} which is outside the current spine bounds (0-${spineItems.length - 1}). Ignoring.`);
                                 }
                            }
                         }
                    }
                    console.log(`loadProgress: Determined last worked-on chapter index: ${lastChapterIndex} (with overall index ${maxOverallIndex})`);
                    // --- End Find Last Chapter ---
                } else {
                    console.log(`loadProgress [${currentFilename}]: No chapter progress map found.`);
                    window.currentBookChapterProgress = {};
                }

            } catch (e) {
                console.error(`loadProgress [${currentFilename}]: Error parsing saved progress:`, e);
                totalBookCharacters = 0; chapterLengths = []; bookLengthCalculated = false; window.currentBookChapterProgress = {};
                lastChapterIndex = 0; // Reset to default on error
            }
        } else {
            console.log(`loadProgress [${currentFilename}]: No saved progress found. Starting fresh.`);
            bookLengthCalculated = false;
            window.currentBookChapterProgress = {};
            lastChapterIndex = 0; // Default for fresh start
        }

        // Return the determined starting chapter index
        console.log(`loadProgress: Returning chapter index to load: ${lastChapterIndex}`);
        return lastChapterIndex;
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

          
    // Removed the initialOffset parameter from the function definition
          
          
          
          
    function loadChunk(chunkIndex, initialOffset = null) {
        // --- Validation and Empty Chapter Handling ---
        if (chunkIndex < 0 || chunkIndex >= chapterChunks.length) {
            if (chapterChunks.length === 0) {
                console.log("loadChunk: No chunks available (chapter likely empty).");
                currentChunkIndex = 0; currentChunkText = ""; currentTypedIndexInChunk = 0; chunkStartIndexInChapter = 0;
                displayChunkText(); updateNavigation(); updateBookProgress();
                sourceTextArea.dataset.readonly = 'true'; // Mark empty as read-only
                return;
            } else {
                console.warn(`loadChunk: Invalid chunk index ${chunkIndex}.`);
                return;
            }
        }
        // --- End Validation ---

        console.log(`loadChunk: Loading chunk ${chunkIndex}. Received initialOffset: ${initialOffset} (type: ${typeof initialOffset})`);
        currentChunkIndex = chunkIndex; // Update the global chunk index

        // --- Calculate start index of THIS chunk ---
        let calculatedStartIndex = 0;
        for (let i = 0; i < currentChunkIndex; i++) { /* ... calculate ... */
             const chunkParas = chapterChunks[i];
             if (chunkParas && chunkParas.length > 0) { /* ... sum length ... */
                let chunkLength = chunkParas[0].length;
                for (let j = 1; j < chunkParas.length; j++) { chunkLength += 1 + chunkParas[j].length; }
                calculatedStartIndex += chunkLength + 1;
             }
        }
        chunkStartIndexInChapter = calculatedStartIndex;
        console.log(`loadChunk: Calculated start index for chunk ${chunkIndex} in chapter: ${chunkStartIndexInChapter}`);
        // --- End Calculate start index ---

        // Join paragraphs
        const currentParas = chapterChunks[currentChunkIndex];
        currentChunkText = currentParas.join(P_BREAK_PLACEHOLDER);
        console.log(`loadChunk: Chunk text length: ${currentChunkText.length}`);

        // --- Read Overall Saved Progress ---
        let overallSavedCharIndex = 0; // Read this value regardless
        if (currentFilename) { /* ... read overallSavedCharIndex from localStorage ... */
            const key = PROGRESS_KEY_PREFIX + currentFilename;
            const savedData = localStorage.getItem(key);
            if (savedData) { try { /* ... parse and set overallSavedCharIndex ... */
                const progressData = JSON.parse(savedData);
                if (progressData.chapterProgress && typeof progressData.chapterProgress === 'object') {
                    const savedValue = progressData.chapterProgress[String(currentChapterIndex)];
                    if (typeof savedValue === 'number' && savedValue >= 0) { overallSavedCharIndex = savedValue; }
                }
             } catch (e) { console.error("loadChunk: Error parsing localStorage data", e); } }
        }
        console.log(`loadChunk: Read overall chapter progress index: ${overallSavedCharIndex}`);
        // --- End Read Progress ---


        // --- Determine Where Typing Resumes (currentTypedIndexInChunk) ---
        let targetOffsetForTyping;
        let typingSource = "";
        if (typeof initialOffset === 'number') { // Use passed offset if valid (usually 0 from backward nav)
            targetOffsetForTyping = initialOffset;
            typingSource = "explicitly passed";
            console.log(`loadChunk: Using explicitly passed initialOffset for typing: ${targetOffsetForTyping}`);
        } else { // Calculate offset from stored progress for forward/initial load
            typingSource = "localStorage calculation";
            targetOffsetForTyping = Math.max(0, overallSavedCharIndex - chunkStartIndexInChapter);
            console.log(`loadChunk: Calculated offset for typing from storage: ${targetOffsetForTyping} (overall ${overallSavedCharIndex} - start ${chunkStartIndexInChapter})`);
        }
        // Clamp and set the final index for typing
        let clampedTypingOffset = Math.min(targetOffsetForTyping, currentChunkText.length);
        currentTypedIndexInChunk = clampedTypingOffset;
        console.log(`loadChunk: Setting currentTypedIndexInChunk to ${currentTypedIndexInChunk} (Source: ${typingSource}, Initial Target: ${targetOffsetForTyping}, Clamped: ${clampedTypingOffset})`);
        // --- End Determine Typing Index ---


        resetTypingStateForNewChunk();
        displayChunkText(); // Render the HTML first

        // --- Restore Visual State based on Overall Saved Progress ---

        // Determine how many characters within THIS chunk should be marked correct
        let charsToMarkCorrectInChunk = Math.max(0, overallSavedCharIndex - chunkStartIndexInChapter);
        charsToMarkCorrectInChunk = Math.min(charsToMarkCorrectInChunk, currentChunkText.length); // Clamp
        console.log(`loadChunk: Restoring visual state up to index ${charsToMarkCorrectInChunk} in chunk (based on overall saved ${overallSavedCharIndex}).`);

        // Determine if the chunk IS visually complete based on this restoration index
        const isVisuallyComplete = (charsToMarkCorrectInChunk >= currentChunkText.length);

        // Apply 'correct' style up to the calculated restoration point
        const loopEndIndex = charsToMarkCorrectInChunk;
        console.log(`loadChunk: Restoration loop running from i=0 to i < ${loopEndIndex}`);
        for (let i = 0; i < loopEndIndex; i++) {
            if (currentChunkText[i] !== P_BREAK_PLACEHOLDER) {
                const charSpan = document.getElementById(`chunk-char-${i}`);
                if (charSpan) {
                    charSpan.classList.remove('incorrect', 'current', 'needs-enter');
                    charSpan.classList.add('correct');
                }
            }
        }

        // If determined complete, ensure typing index is at end & clear trailing needs-enter
        if (isVisuallyComplete) {
             console.log("loadChunk: Chunk rendered as visually complete.");
             if (currentTypedIndexInChunk < currentChunkText.length) {
                 currentTypedIndexInChunk = currentChunkText.length;
                 console.log(`loadChunk: Adjusted typing index to ${currentTypedIndexInChunk} to match visual completion.`);
             }
              // Ensure no 'needs-enter' on last char if complete
              if (currentChunkText.length > 0) {
                   const lastCharSpan = document.getElementById(`chunk-char-${currentChunkText.length - 1}`);
                   lastCharSpan?.classList.remove('needs-enter');
              }
        }
        // Otherwise, restore 'needs-enter' if necessary
        else if (charsToMarkCorrectInChunk > 0 && charsToMarkCorrectInChunk < currentChunkText.length) {
             const charAfterCorrect = currentChunkText[charsToMarkCorrectInChunk];
             if (charAfterCorrect === P_BREAK_PLACEHOLDER) {
                  const prevCharIndex = charsToMarkCorrectInChunk - 1;
                  const prevCharSpan = document.getElementById(`chunk-char-${prevCharIndex}`);
                  if (prevCharSpan) {
                      prevCharSpan.classList.add('needs-enter');
                      console.log(`loadChunk: Restored needs-enter state for chunk index ${prevCharIndex}`);
                  }
             }
         }
        // --- End Restore Visual State ---

         // --- Set Read-Only State ---
         sourceTextArea.dataset.readonly = isVisuallyComplete ? 'true' : 'false';
         console.log(`loadChunk: Setting chunk read-only state to: ${sourceTextArea.dataset.readonly}`);
         // --- End Set Read-Only State ---

        // --- Update UI ---
        updateStats();
        updateNavigation();
        updateBookProgress();
        updateCursor(); // Position cursor based on currentTypedIndexInChunk

        // Focus input only if chunk is not visually complete
        if (!isVisuallyComplete) {
             try { hiddenInput.focus(); } catch(e) { console.warn("Focus failed", e); }
        } else {
             console.log("loadChunk: Chunk loaded at completed state.");
        }
    } // End loadChunk



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

        // --- Check for Chapter/Completion Boundaries ---
        if (direction === 1) { // === Trying to go FORWARD ===
            // Completion check to prevent advancing *past* an incomplete chunk
            let isChunkComplete = currentTypedIndexInChunk >= currentChunkText.length;
            let isWaitingForEnter = false;
            if (currentTypedIndexInChunk > 0) {
                 const lastCharSpan = document.getElementById(`chunk-char-${currentTypedIndexInChunk - 1}`);
                 isWaitingForEnter = lastCharSpan?.classList.contains('needs-enter') ?? false;
            }
            if (!isChunkComplete || isWaitingForEnter) {
                 console.log("navigateChunk: Cannot navigate forward, current chunk not complete.");
                 return; // Block forward navigation
            }
            // Chapter Boundary Check (If complete and going past last chunk)
            if (newChunkIndex >= chapterChunks.length) {
                 console.log("navigateChunk: At end of last chunk, attempting to navigate to next chapter.");
                 // Note: navigateChapter handles saving internally now
                 navigateChapter(1);
                 return;
            }
        } else if (direction === -1) { // === Trying to go BACKWARD ===
            // Chapter Boundary Check (If at first chunk)
            if (currentChunkIndex <= 0) {
                console.log("navigateChunk: At start of first chunk, attempting to navigate to previous chapter.");
                 // Note: navigateChapter handles saving internally now
                navigateChapter(-1);
                return;
            }
        }
        // --- End Boundary Check ---


        // --- Normal Chunk Navigation (within the same chapter) ---
        if (newChunkIndex >= 0 && newChunkIndex < chapterChunks.length) {
            console.log(`Navigating chunk from ${currentChunkIndex} to ${newChunkIndex}`);
            // *** REMOVED saveProgress() call from here ***

            // Pass explicit offset 0 ONLY when going backward
            if (direction === -1) {
                loadChunk(newChunkIndex, 0); // Load previous chunk at its start
            } else {
                // Load next chunk, let it calculate offset from saved progress
                loadChunk(newChunkIndex);
            }
        } else {
             console.log(`Chunk navigation failed: Target Index ${newChunkIndex} invalid.`);
        }
    }


}); // End DOMContentLoaded

