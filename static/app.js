document.addEventListener('DOMContentLoaded', () => {
    const sessionId = Math.random().toString(36).substring(2, 15);
    const textInput = document.getElementById('text-input');
    const sendButton = document.getElementById('send-button');
    const characterImage = document.getElementById('character-image');
    const voiceSelect = document.getElementById('voice-select');
    const status = document.getElementById('status');

    // Define all expression image paths based on newly generated assets
    const images = {
        neutral: `/static/images/max-neutral-smirk.png?v=${sessionId}`,
        slightlyOpen: `/static/images/max-mouth-slightly-open.png?v=${sessionId}`,
        open: `/static/images/max-mouth-open.png?v=${sessionId}`,
        emphasis: `/static/images/max-emphasis-pose.png?v=${sessionId}`,
        sarcastic: `/static/images/max-sarcastic-knowing.png?v=${sessionId}`,
        laugh: `/static/images/max-open-laugh.png?v=${sessionId}`
    };

    // Apply default closed image immediately
    characterImage.src = images.neutral;

    // Preload all expression images to prevent flickering
    Object.values(images).forEach(src => {
        const img = new Image();
        img.src = src;
    });

    let voices = [];
    let lipSyncInterval;
    let isProcessing = false; 
    let currentSpeechSessionId = 0;

    function populateVoiceList() {
        const allVoices = speechSynthesis.getVoices();
        voices = allVoices.filter(voice => voice.name.includes('Google'));
        voiceSelect.innerHTML = '';

        let usVoiceIndex = -1;

        voices.forEach((voice, i) => {
            const option = document.createElement('option');
            option.textContent = `${voice.name} (${voice.lang})`;
            option.setAttribute('data-lang', voice.lang);
            option.setAttribute('data-name', voice.name);
            voiceSelect.appendChild(option);

            if (voice.lang === 'en-US') {
                if (usVoiceIndex === -1) { // Find the first US voice
                    usVoiceIndex = i;
                }
            }
        });

        if (usVoiceIndex !== -1) {
            voiceSelect.selectedIndex = usVoiceIndex;
        }
    }

    populateVoiceList();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = populateVoiceList;
    }

    const typewriter = (text, element, speed = 40) => {
        return new Promise((resolve) => {
            // Use Intl.Segmenter to handle grapheme clusters correctly
            if (window.Intl && Intl.Segmenter) {
                const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
                const segments = Array.from(segmenter.segment(text)).map(s => s.segment);
                
                let i = 0;
                element.innerHTML = "";

                function type() {
                    if (i < segments.length) {
                        element.innerHTML += segments[i];
                        i++;
                        setTimeout(type, speed);
                    } else {
                        resolve();
                    }
                }
                type();
            } else {
                // Fallback for older browsers
                let i = 0;
                element.innerHTML = "";
                function type() {
                    if (i < text.length) {
                        element.innerHTML += text.charAt(i);
                        i++;
                        setTimeout(type, speed);
                    } else {
                        resolve();
                    }
                }
                type();
            }
        });
    };

    const parseResponse = (responseText) => {
        const segments = [];
        // Matches tags like [neutral], [emphasis], [sarcastic], [laugh] followed by any characters until the next tag
        const regex = /\[(neutral|emphasis|sarcastic|laugh)\]\s*([^[]+)/g;
        let match;
        
        while ((match = regex.exec(responseText)) !== null) {
            segments.push({
                expression: match[1],
                text: match[2].trim()
            });
        }

        // Fallback if no tags are matched
        if (segments.length === 0) {
            // Check if there are any rogue tag-like brackets, otherwise treat as neutral
            segments.push({
                expression: 'neutral',
                text: responseText.replace(/\[.*?\]/g, '').trim()
            });
        }
        return segments;
    };

    const speakSegments = async (segments) => {
        const sessionId = ++currentSpeechSessionId;
        
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
        clearInterval(lipSyncInterval);
        
        status.innerHTML = "";

        for (const segment of segments) {
            if (sessionId !== currentSpeechSessionId) return;

            await new Promise((resolve) => {
                // Determine closed-pose and open-mouth images for this segment's emotion
                let closedImg = images.neutral;
                if (segment.expression === 'sarcastic') {
                    closedImg = images.sarcastic;
                } else if (segment.expression === 'emphasis') {
                    closedImg = images.emphasis;
                } else if (segment.expression === 'laugh') {
                    closedImg = images.laugh;
                }

                // Alternate between the active closed-pose image and the open-mouth image during speech
                const openImg = images.open;
                characterImage.src = closedImg;

                const utterance = new SpeechSynthesisUtterance(segment.text);
                const selectedOption = voiceSelect.selectedOptions[0]?.getAttribute('data-name');
                const selectedVoice = voices.find(voice => voice.name === selectedOption);
                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                }

                // Create segment span for appending
                const segmentSpan = document.createElement('span');
                status.appendChild(segmentSpan);
                
                // Start typing the text for this segment
                typewriter(segment.text + " ", segmentSpan);

                utterance.onstart = () => {
                    if (sessionId !== currentSpeechSessionId) {
                        resolve();
                        return;
                    }
                    let mouthOpen = true;
                    clearInterval(lipSyncInterval);
                    lipSyncInterval = setInterval(() => {
                        if (sessionId !== currentSpeechSessionId) {
                            clearInterval(lipSyncInterval);
                            resolve();
                            return;
                        }
                        characterImage.src = mouthOpen ? openImg : closedImg;
                        mouthOpen = !mouthOpen;
                    }, 150);
                };

                utterance.onend = () => {
                    clearInterval(lipSyncInterval);
                    characterImage.src = closedImg;
                    resolve();
                };

                utterance.onerror = () => {
                    clearInterval(lipSyncInterval);
                    characterImage.src = closedImg;
                    resolve();
                };

                speechSynthesis.speak(utterance);
            });
        }
        
        if (sessionId === currentSpeechSessionId) {
            characterImage.src = images.neutral;
        }
    };

    const handleSendMessage = async () => {
        const message = textInput.value.trim();
        if (!message) return;
        if (isProcessing) return;  // block if already waiting on a response

        isProcessing = true;
        sendButton.disabled = true;  // visual feedback too

        textInput.value = '';
        textInput.style.height = '50px';
        status.textContent = "Thinking...";

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message, session_id: sessionId }),
            });

            if (!response.ok) throw new Error('Network response was not ok');

            const data = await response.json();
            const segments = parseResponse(data.response);
            await speakSegments(segments);

        } catch (error) {
            console.error('Error:', error);
            const errorMessage = '[neutral] Sorry, something went wrong. Please try again.';
            const segments = parseResponse(errorMessage);
            await speakSegments(segments);
        } finally {
            isProcessing = false;       // always release the lock
            sendButton.disabled = false; // re-enable button
        }
    };

    sendButton.addEventListener('click', handleSendMessage);

    textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    textInput.addEventListener('input', () => {
        textInput.style.height = 'auto';
        textInput.style.height = `${textInput.scrollHeight}px`;
    });
});
