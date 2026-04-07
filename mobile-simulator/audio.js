/**
 * Audio Recording Module
 * ======================
 * Uses the MediaRecorder API to capture audio from the microphone.
 * Falls back gracefully if permissions are denied.
 */

const AudioModule = (() => {
    let mediaRecorder = null;
    let audioChunks = [];
    let stream = null;
    let isRecording = false;

    async function requestMic() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            return true;
        } catch (err) {
            console.warn('Microphone access denied or unavailable:', err.message);
            return false;
        }
    }

    function stopStream() {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
    }

    return {
        /**
         * Start recording audio.
         * Returns true if recording started, false if mic unavailable.
         */
        async startRecording() {
            if (isRecording) return true;

            const hasAccess = await requestMic();
            if (!hasAccess) return false;

            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm'
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.start(1000); // Collect in 1s chunks
            isRecording = true;
            return true;
        },

        /**
         * Stop recording and return the audio Blob.
         * Returns null if nothing was recorded.
         */
        stopRecording() {
            return new Promise((resolve) => {
                if (!mediaRecorder || !isRecording) {
                    resolve(null);
                    return;
                }

                mediaRecorder.onstop = () => {
                    const blob = audioChunks.length > 0
                        ? new Blob(audioChunks, { type: 'audio/webm' })
                        : null;
                    audioChunks = [];
                    isRecording = false;
                    stopStream();
                    resolve(blob);
                };

                mediaRecorder.stop();
            });
        },

        /**
         * Upload audio blob to the backend.
         */
        async uploadAudio(emergencyId, blob) {
            if (!blob) return false;

            const formData = new FormData();
            formData.append('file', blob, `recording_${emergencyId}.webm`);

            try {
                const resp = await fetch(`/api/emergency/${emergencyId}/audio`, {
                    method: 'POST',
                    body: formData
                });
                return resp.ok;
            } catch (err) {
                console.error('Failed to upload audio:', err);
                return false;
            }
        },

        isActive() {
            return isRecording;
        }
    };
})();
