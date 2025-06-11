// At the VERY TOP of static/js/main.js (before anything else)
console.log("MAIN.JS SCRIPT FILE HAS STARTED LOADING (TOP OF FILE)");

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed -DOMContentLoaded event fired-");

    // --- Get HTML Elements ---
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const voiceButton = document.getElementById('voiceButton');
    const conversationDiv = document.getElementById('conversation');
    const live2dCanvas = document.getElementById('live2d-canvas');
    console.log("HTML Elements: userInput:", userInput ? "Found" : "NOT FOUND!", "sendButton:", sendButton ? "Found" : "NOT FOUND!", "conversationDiv:", conversationDiv ? "Found" : "NOT FOUND!", "live2dCanvas:", live2dCanvas ? "Found" : "NOT FOUND!");

    // --- Global-like variables for this DOMContentLoaded scope ---
    let live2DModelInstance = null;
    const backendAudioElement = new Audio();
    // TODO: CUSTOMIZE - Replace with your model's actual idle motion group names. Ensure they exist in your model!
    const IDLE_MOTION_GROUP_NAMES = ["Idle", "Idle_A", "Idle_B", "Standby", "Breath"]; // Example names
    let currentIdleTimeout = null;
    let isSpeakingOrPlayingSpecificMotion = false;

    let userActivityTimeout = null;
    const USER_IDLE_TIMEOUT_MS = 45000; // Yuki speaks if user is idle for 45 seconds
    let lastInteractionTime = Date.now();
    console.log("State variables initialized.");

    // --- Essential HTML Element Checks (critical ones) ---
    if (!conversationDiv || !live2dCanvas) {
        console.error("CRITICAL FAILURE: conversationDiv or live2dCanvas not found! Script will halt major functions.");
        if(conversationDiv) conversationDiv.innerHTML = "<p><em>Critical page element missing. Application cannot start.</em></p>";
        return; // Stop further execution in this callback
    }
    if (!userInput) { console.warn("WARNING: userInput element not found! Text input may not work.");}
    if (!sendButton) { console.warn("WARNING: sendButton element not found! Sending messages by button may not work.");}
    console.log("Initial HTML element checks completed.");

    // --- PIXI and Live2D Library Checks ---
    console.log("Checking PIXI and PIXI.live2d objects...");
    if (typeof PIXI === 'undefined') {
        console.error("FATAL: PIXI object IS UNDEFINED! Ensure pixi.js (or pixi.min.js from CDN) is loaded BEFORE main.js. Halting.");
        if (conversationDiv) conversationDiv.innerHTML += `<p><em>Error: Graphics library (PIXI) missing. Model cannot load.</em></p>`;
        return; // Stop further execution
    }
    console.log("PIXI object IS DEFINED. Version:", PIXI.VERSION);
    if (typeof PIXI.live2d === 'undefined') {
        console.error("FATAL: PIXI.live2d object IS UNDEFINED! Ensure pixi-live2d-display (e.g., cubism4.min.js from CDN) is loaded AFTER PIXI and BEFORE main.js. Halting.");
        if (conversationDiv) conversationDiv.innerHTML += `<p><em>Error: Live2D library (PIXI.live2d) missing. Model cannot load.</em></p>`;
        return; // Stop further execution
    }
    console.log("PIXI.live2d object IS DEFINED.");
    console.log("PIXI and PIXI.live2d library checks passed.");

    // --- Live2D Initialization Variables ---
    console.log("Defining PIXI.Application settings...");
    const app = new PIXI.Application({
        view: live2dCanvas,
        width: live2dCanvas.width,
        height: live2dCanvas.height,
        transparent: true,
        autoStart: true,
    });
    console.log("PIXI.Application instance created.");

    // Define modelPath here, it will be in scope for loadLive2DModel
    const modelPath = '/static/models/chibay/march 7th.model3.json';
    console.log("Live2D Model path set to:", modelPath);

    // --- FUNCTION DEFINITIONS ---

    function appendMessage(sender, text) {
        if (!conversationDiv) return;
        const messageP = document.createElement('p');
        messageP.innerHTML = `<strong>${sender}:</strong> ${text}`;
        conversationDiv.appendChild(messageP);
        conversationDiv.scrollTop = conversationDiv.scrollHeight;
    }

    function playRandomIdleMotion() {
        if (currentIdleTimeout) clearTimeout(currentIdleTimeout);
        if (!live2DModelInstance || isSpeakingOrPlayingSpecificMotion) {
            if (isSpeakingOrPlayingSpecificMotion) { currentIdleTimeout = setTimeout(playRandomIdleMotion, 5000); }
            return;
        }
        if (IDLE_MOTION_GROUP_NAMES.length === 0) { console.warn("No idle motions in IDLE_MOTION_GROUP_NAMES."); return; }
        const randomIdleGroup = IDLE_MOTION_GROUP_NAMES[Math.floor(Math.random() * IDLE_MOTION_GROUP_NAMES.length)];
        console.log(`Attempting idle: ${randomIdleGroup}`);
        live2DModelInstance.motion(randomIdleGroup, undefined, PIXI.live2d.MotionPriority.IDLE)
            .then(() => {
                if (!isSpeakingOrPlayingSpecificMotion) {
                    let nextIdleDelay = 7000 + Math.random() * 8000;
                    currentIdleTimeout = setTimeout(playRandomIdleMotion, nextIdleDelay);
                }
            })
            .catch(err => {
                console.warn(`Failed idle motion '${randomIdleGroup}':`, err);
                if (!isSpeakingOrPlayingSpecificMotion) { currentIdleTimeout = setTimeout(playRandomIdleMotion, 10000); }
            });
    }

    function startIdleAnimation() {
        console.log("startIdleAnimation called to initiate idle loop.");
        isSpeakingOrPlayingSpecificMotion = false; // Ensure flag is false
        playRandomIdleMotion();
    }

    function resetUserActivityTimer() {
        lastInteractionTime = Date.now();
        if (userActivityTimeout) clearTimeout(userActivityTimeout);
        userActivityTimeout = setTimeout(yukiInitiatesConversation, USER_IDLE_TIMEOUT_MS);
        // console.log("User activity timer reset.");
    }

    function speakResponseBrowserTTS(text) {
        console.log("speakResponseBrowserTTS for:", text ? text.substring(0,30)+"..." : "EMPTY");
        if (!('speechSynthesis' in window)) {
            console.warn('Browser Speech Synthesis not supported.'); appendMessage('System', 'Browser TTS not supported.');
            isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer(); return;
        }
        isSpeakingOrPlayingSpecificMotion = true; clearTimeout(currentIdleTimeout);
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        // Voice selection logic (simplified for brevity, use your more detailed one if needed)
        let voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
            let desiredVoice = voices.find(voice => voice.lang.startsWith('en') && (voice.name.toLowerCase().includes('female') || voice.name.toLowerCase().includes('zira') || voice.name.toLowerCase().includes('samantha')));
            if (desiredVoice) utterance.voice = desiredVoice;
        } else { // Handle case where voices are not loaded yet
            speechSynthesis.onvoiceschanged = () => {
                voices = speechSynthesis.getVoices();
                let desiredVoice = voices.find(voice => voice.lang.startsWith('en') && (voice.name.toLowerCase().includes('female') || voice.name.toLowerCase().includes('zira') || voice.name.toLowerCase().includes('samantha')));
                if (desiredVoice) utterance.voice = desiredVoice; // This might be too late if speak() was already called
            };
        }

        const mouthOpenParam = 'ParamMouthOpenY'; // TODO: CUSTOMIZE for March 7th
        const speakingAmplitude = 0.6;

        if (live2DModelInstance && live2DModelInstance.internalModel && live2DModelInstance.internalModel.coreModel) {
            utterance.onstart = () => {
                console.log("Browser TTS started, manual mouth open.");
                live2DModelInstance.internalModel.coreModel.setParameterValueById(mouthOpenParam, speakingAmplitude);
            };
            utterance.onend = () => {
                console.log("Browser TTS ended, closing mouth.");
                live2DModelInstance.internalModel.coreModel.setParameterValueById(mouthOpenParam, 0);
                isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer();
            };
            utterance.onerror = () => {
                console.warn("Browser TTS error.");
                live2DModelInstance.internalModel.coreModel.setParameterValueById(mouthOpenParam, 0);
                isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer();
            };
        } else { // Fallback if model not fully ready for lip sync params
            console.warn("Live2D model not ready for detailed lip sync; speaking without parameter changes.");
            utterance.onstart = () => { isSpeakingOrPlayingSpecificMotion = true; clearTimeout(currentIdleTimeout); };
            utterance.onend = () => { isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer(); };
            utterance.onerror = () => { isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer(); };
        }
        speechSynthesis.speak(utterance);
    }

    function playAudioFromUrlWithLipSync(audioUrl, fallbackText) {
        console.log("playAudioFromUrlWithLipSync for URL:", audioUrl);
        isSpeakingOrPlayingSpecificMotion = true; clearTimeout(currentIdleTimeout);
        backendAudioElement.src = audioUrl;
        backendAudioElement.oncanplaythrough = () => {
            backendAudioElement.play().then(() => {
                console.log("Backend audio playback started:", audioUrl);
            }).catch(error => {
                console.error("Error starting backend audio playback:", audioUrl, error);
                speakResponseBrowserTTS(fallbackText);
                if (!('speechSynthesis' in window)) { isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer(); }
            });
        };
        backendAudioElement.onended = () => {
            console.log("Backend audio finished.");
            isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer();
        };
        backendAudioElement.onerror = (e) => {
            console.error("HTML Audio Element Error on backend audio:", backendAudioElement.error, e);
            speakResponseBrowserTTS(fallbackText);
            if (!('speechSynthesis' in window)) { isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer(); }
        };
        backendAudioElement.load();
    }

    async function yukiInitiatesConversation() {
        if (isSpeakingOrPlayingSpecificMotion || (Date.now() - lastInteractionTime < USER_IDLE_TIMEOUT_MS - 1000)) {
             resetUserActivityTimer(); return;
        }
        console.log("Yuki initiating conversation.");
        isSpeakingOrPlayingSpecificMotion = true; clearTimeout(currentIdleTimeout);

        // TODO: CUSTOMIZE - Yuki's thinking expression and motion names
        const thinkingExpression = "thinking";
        const thinkingMotion = "Thinking";

        if (live2DModelInstance) {
            live2DModelInstance.expression(thinkingExpression).catch(e => console.warn("Proactive think expr err:", e));
            if (thinkingMotion && thinkingMotion.toLowerCase() !== "idle" && !IDLE_MOTION_GROUP_NAMES.map(n=>n.toLowerCase()).includes(thinkingMotion.toLowerCase())) {
                live2DModelInstance.motion(thinkingMotion, undefined, PIXI.live2d.MotionPriority.NORMAL).catch(e => console.warn("Proactive think motion err:", e));
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 2000));

        try {
            console.log("Fetching proactive message from backend.");
            const response = await fetch('/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify({ message: "[USER_IS_QUIET_YUKI_PLEASE_SPEAK]" }),
            });
            if (!response.ok) { throw new Error(`Server error for proactive: ${response.status}`); }
            const data = await response.json();
            console.log("Proactive response from backend:", data);
            appendMessage('AI', data.response);

            if (live2DModelInstance) {
                if (data.emotion && data.emotion !== "neutral") { live2DModelInstance.expression(data.emotion).catch(e=>console.warn("Proactive expr err:",e)); }
                else { live2DModelInstance.expression().catch(e=>console.warn("Proactive clear expr err:",e)); }
                
                if (data.motion && data.motion.toLowerCase() !== "idle" && !IDLE_MOTION_GROUP_NAMES.map(n=>n.toLowerCase()).includes(data.motion.toLowerCase())) {
                     live2DModelInstance.motion(data.motion, undefined, PIXI.live2d.MotionPriority.FORCE).catch(e=>console.warn("Proactive motion err:",e));
                } else { startIdleAnimation(); }
            }
            if (data.audio_url) { playAudioFromUrlWithLipSync(data.audio_url, data.response); }
            else { speakResponseBrowserTTS(data.response); }
        } catch (error) {
            console.error('Error in yukiInitiatesConversation fetch/processing:', error);
            isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer();
        }
    }

    async function sendMessage(message) {
        console.log("sendMessage called with:", message);
        if (!message.trim() || !userInput) return; // Added check for userInput
        resetUserActivityTimer();
        appendMessage('You', message);
        userInput.value = '';
        isSpeakingOrPlayingSpecificMotion = true; clearTimeout(currentIdleTimeout);
        console.log("isSpeakingOrPlayingSpecificMotion SET TO TRUE by sendMessage");

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            });
            if (!response.ok) { throw new Error(`Server error: ${response.status}`); }
            const data = await response.json();
            console.log("Received data from /chat:", data);
            appendMessage('AI', data.response);

            if (live2DModelInstance) {
                if (data.emotion && data.emotion.toLowerCase() !== "neutral") {
                    live2DModelInstance.expression(data.emotion).catch(err => console.warn(`Expr fail: '${data.emotion}'`, err));
                } else {
                    live2DModelInstance.expression().catch(err => console.warn("Clear expr fail", err));
                }
                if (data.motion && data.motion.toLowerCase() !== "idle" && !IDLE_MOTION_GROUP_NAMES.map(n=>n.toLowerCase()).includes(data.motion.toLowerCase())) {
                    live2DModelInstance.motion(data.motion, undefined, PIXI.live2d.MotionPriority.FORCE)
                        .catch(err => console.warn(`Motion fail: '${data.motion}'`, err));
                } else { startIdleAnimation(); }
            }
            if (data.audio_url) { playAudioFromUrlWithLipSync(data.audio_url, data.response); }
            else { speakResponseBrowserTTS(data.response); }
        } catch (error) {
            console.error('Error sending/processing msg:', error);
            isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer();
            appendMessage('Error', `Failed to get response: ${error.message}`);
        }
    }

    async function loadLive2DModel() {
        console.log("loadLive2DModel function called.");
        // modelPath is already defined in the outer scope
        console.log("Inside loadLive2DModel, accessing modelPath:", modelPath);
        try {
            console.log("Attempting to load Live2D model from:", modelPath);
            const model = await PIXI.live2d.Live2DModel.from(modelPath, {
                autoInteract: false,
                autoUpdate: true,
            });
            console.log("PIXI.live2d.Live2DModel.from() SUCCEEDED.");
            app.stage.addChild(model);
            console.log("Model added to PIXI stage.");
            live2DModelInstance = model;
            console.log("live2DModelInstance assigned.");

            // TODO: CUSTOMIZE - YOUR OPTIMAL SCALE AND Y POSITION for March 7th
            model.anchor.set(0.5, 0.5);
            model.x = app.renderer.width / 2;
            let scaleFactor = 0.09; // EXAMPLE - USE YOUR VALUE that makes her look good
            model.scale.set(scaleFactor);
            // Example Y positioning, adjust this too
            model.y = app.renderer.height - (model.height / 2) - (app.renderer.height * 0.05); 

            console.log(`Live2D Model positioned. Scale: ${scaleFactor}, X: ${model.x.toFixed(1)}, Y: ${model.y.toFixed(1)}`);

            if (model.internalModel && model.internalModel.motionManager) { console.log("Model has motionManager."); }
            else { console.warn("Model structure might be different for lip sync/motion."); }

            console.log("Calling startIdleAnimation() from loadLive2DModel.");
            startIdleAnimation();
            console.log("Calling resetUserActivityTimer() from loadLive2DModel.");
            resetUserActivityTimer();

            // TODO: CUSTOMIZE - Hit area and motion names
            model.on('hit', (hitAreas) => {
                if (!live2DModelInstance || isSpeakingOrPlayingSpecificMotion) return;
                console.log("Hit on:", hitAreas);
                isSpeakingOrPlayingSpecificMotion = true; clearTimeout(currentIdleTimeout);
                let motionPlayed = false;
                const handleHitMotionEnd = () => { isSpeakingOrPlayingSpecificMotion = false; playRandomIdleMotion(); resetUserActivityTimer(); };
                const handleHitMotionError = (e, area) => { console.warn(`Hit ${area} motion error:`, e); handleHitMotionEnd(); };

                if (hitAreas.includes('Body')) { // Example name
                    live2DModelInstance.motion('TapBody', undefined, PIXI.live2d.MotionPriority.FORCE)
                        .then(handleHitMotionEnd).catch(e => handleHitMotionError(e, 'Body'));
                    motionPlayed = true;
                } else if (hitAreas.includes('Head')) { // Example name
                    live2DModelInstance.motion('TapHead', undefined, PIXI.live2d.MotionPriority.FORCE)
                        .then(handleHitMotionEnd).catch(e => handleHitMotionError(e, 'Head'));
                    motionPlayed = true;
                }
                if (!motionPlayed) { handleHitMotionEnd(); }
            });
            console.log("Hit listeners attached.");
            console.log("Live2D Model setup in loadLive2DModel completed.");
        } catch (error) {
            console.error("ERROR INSIDE loadLive2DModel CATCH BLOCK:", error);
            if (conversationDiv) conversationDiv.innerHTML += `<p><em>Major Error loading Live2D model. Path: ${modelPath}. Check console.</em></p>`;
        }
    }

    // --- SCRIPT INITIALIZATION ---
    console.log("Attaching event listeners and starting model load...");
    if (PIXI && PIXI.live2d) {
        console.log("PIXI and PIXI.live2d OK. Calling loadLive2DModel()...");
        loadLive2DModel(); // This is the main call to start loading the model
    } else {
        console.error("PIXI or PIXI.live2d was not ready at the point of model load call. This should have been caught earlier.");
        if(conversationDiv) conversationDiv.innerHTML += `<p><em>FATAL: Core graphics libraries not ready. Cannot load model.</em></p>`;
    }

    if (sendButton && userInput) {
        sendButton.addEventListener('click', () => {
            if (userInput.value.trim() !== "") { sendMessage(userInput.value); }
        });
        userInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                if (userInput.value.trim() !== "") { sendMessage(userInput.value); }
            }
        });
        console.log("Send button and user input event listeners ATTACHED.");
    } else {
        console.warn("Send button or user input field not found. Chat text input will NOT work.");
    }

    if (voiceButton) {
        voiceButton.addEventListener('click', () => { alert("Web voice input not implemented yet."); resetUserActivityTimer(); });
        console.log("Voice button event listener ATTACHED.");
    } else { console.warn("Voice button not found."); }
    
    console.log("End of DOMContentLoaded synchronous setup. Model loading is async and has been initiated if libraries were ready.");
});

console.log("MAIN.JS SCRIPT FILE HAS FINISHED LOADING (BOTTOM OF FILE).");