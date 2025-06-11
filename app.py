import re
from flask import Flask, render_template, request, jsonify, url_for
import requests
import json
import os
import time
import asyncio
import edge_tts

# --- Add Applio root to sys.path for RVC imports ---
import sys
APPLIO_ROOT_DIR = r"C:\Users\KIET\Applio_Release\ApplioV3.2.9" # Path to your COMPILED Applio installation
if APPLIO_ROOT_DIR not in sys.path:
    sys.path.insert(0, APPLIO_ROOT_DIR)

# --- Diagnostic Prints (these run once when the script starts) ---
print("--- DIAGNOSTICS START ---")
print("--- Current sys.path ---")
for p_idx, p_val in enumerate(sys.path): print(f"sys.path[{p_idx}]: {p_val}")
print("------------------------")
print(f"Is APPLIO_ROOT_DIR ('{APPLIO_ROOT_DIR}') in sys.path? {'Yes' if APPLIO_ROOT_DIR in sys.path else 'No'}")
print(f"Checking existence of Applio structure for RVC import (relative to APPLIO_ROOT_DIR):")
rvc_package_path = os.path.join(APPLIO_ROOT_DIR, 'rvc'); rvc_init_path = os.path.join(rvc_package_path, '__init__.py')
rvc_infer_subpackage_path = os.path.join(rvc_package_path, 'infer'); rvc_infer_init_path = os.path.join(rvc_infer_subpackage_path, '__init__.py')
rvc_infer_module_path = os.path.join(rvc_infer_subpackage_path, 'infer.py')
print(f"  '{rvc_package_path}' exists? {os.path.isdir(rvc_package_path)}")
print(f"  '{rvc_init_path}' exists? {os.path.isfile(rvc_init_path)}")
print(f"  '{rvc_infer_subpackage_path}' exists? {os.path.isdir(rvc_infer_subpackage_path)}")
print(f"  '{rvc_infer_init_path}' exists? {os.path.isfile(rvc_infer_init_path)}")
print(f"  '{rvc_infer_module_path}' exists? {os.path.isfile(rvc_infer_module_path)}")
print("Attempting to import VoiceConverter...")
# --- END OF DIAGNOSTIC PRINTS ---

VoiceConverter = None # Define globally as None first
try:
    from rvc.infer.infer import VoiceConverter as RVC_VoiceConverter # Use an alias
    VoiceConverter = RVC_VoiceConverter # Assign if import is successful
    print("Successfully imported VoiceConverter as RVC_VoiceConverter!")
except ModuleNotFoundError as e_import:
    print(f"CRITICAL IMPORT ERROR (rvc.infer.infer): {e_import}")
    print("Ensure APPLIO_ROOT_DIR is correct, sys.path includes it, and rvc & rvc/infer have __init__.py files.")
    print("Also ensure all RVC dependencies (PyTorch, librosa, etc.) are in the active venv.")
except Exception as e_generic_import:
    print(f"CRITICAL GENERIC IMPORT ERROR: {e_generic_import}"); import traceback; traceback.print_exc()

# --- Flask App Initialization ---
app = Flask(__name__)
RVC_AUDIO_OUTPUT_DIR = os.path.join(app.static_folder, 'rvc_audio_cache')
os.makedirs(RVC_AUDIO_OUTPUT_DIR, exist_ok=True)
print(f"RVC audio will be saved in: {os.path.abspath(RVC_AUDIO_OUTPUT_DIR)}")

# --- Configurations ---
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL = "llama3"
OLLAMA_API_ENDPOINT_CHAT = f"{OLLAMA_BASE_URL}/api/chat"

# --- RVC Model Configuration ---
# !! IMPORTANT: Update these paths to your actual trained model files !!
# These should point to the .pth and .index files from your *original* Applio training (e.g., in C:\Users\KIET\Applio\logs\YourModelName)
RVC_MODEL_PATH = r"C:\Users\KIET\Applio\logs\Yuki Shinagawa\Yuki Shinagawa_200e_1200s.pth" # Or your March7th model
RVC_INDEX_PATH = r"C:\Users\KIET\Applio\logs\Yuki Shinagawa\Yuki Shinagawa.index"       # Or your March7th index

BASE_TTS_VOICE = "en-US-AnaNeural" # EdgeTTS voice for base audio

# --- Initialize VoiceConverter globally ---
voice_converter_instance = None
if VoiceConverter is not None:
    try:
        print("[RVC] Initializing VoiceConverter instance...")
        voice_converter_instance = VoiceConverter() # This uses Config() from Applio's rvc.configs
        print("[RVC] VoiceConverter instance initialized.")
    except Exception as e_init_vc:
        print(f"[RVC] CRITICAL ERROR: Could not initialize VoiceConverter instance: {e_init_vc}")
        import traceback; traceback.print_exc()
else:
    print("[RVC] VoiceConverter class was not imported. RVC functionality will be disabled.")

# --- Helper Functions ---
async def generate_base_audio_with_edge_tts(text, voice, output_path):
    try:
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(output_path)
        print(f"[EdgeTTS] Base audio saved to {output_path}")
        return True
    except Exception as e:
        print(f"[EdgeTTS] Error generating base audio: {e}")
        return False

def generate_rvc_voice(text_to_speak, output_filename_stem="yuki_rvc_output"):
    if voice_converter_instance is None:
        print("[RVC] VoiceConverter not available. Skipping RVC generation.")
        return None

    print(f"[RVC] Request to generate voice for: '{text_to_speak}'")
    timestamp = int(time.time() * 1000)
    base_audio_filename = f"base_{output_filename_stem}_{timestamp}.wav"
    base_audio_filepath = os.path.join(RVC_AUDIO_OUTPUT_DIR, base_audio_filename)
    final_rvc_audio_filename = f"{output_filename_stem}_{timestamp}.wav"
    final_rvc_audio_filepath = os.path.join(RVC_AUDIO_OUTPUT_DIR, final_rvc_audio_filename)

    # Generate base audio using EdgeTTS
    loop = asyncio.new_event_loop(); asyncio.set_event_loop(loop)
    base_audio_success = loop.run_until_complete(generate_base_audio_with_edge_tts(text_to_speak, BASE_TTS_VOICE, base_audio_filepath))
    loop.close()

    if not base_audio_success or not os.path.exists(base_audio_filepath) or os.path.getsize(base_audio_filepath) == 0:
        print("[RVC] Failed to generate base audio with EdgeTTS.")
        if os.path.exists(base_audio_filepath): os.remove(base_audio_filepath)
        return None

    try:
        # Optimal RVC inference settings (you found these by testing in Applio UI)
        transpose_pitch = 0
        f0_extraction_method = "rmvpe" # Ensure this matches what your Pipeline expects/supports
        feature_index_rate = 0.75
        consonant_protection = 0.5
        speaker_id_rvc = 0

        print(f"[RVC] Calling VoiceConverter.convert_audio with input: {base_audio_filepath}")
        # This calls the convert_audio method from Applio's rvc.infer.infer.VoiceConverter
        voice_converter_instance.convert_audio(
            audio_input_path=base_audio_filepath,
            audio_output_path=final_rvc_audio_filepath,
            model_path=RVC_MODEL_PATH,
            index_path=RVC_INDEX_PATH,
            pitch=transpose_pitch,
            f0_method=f0_extraction_method,
            index_rate=feature_index_rate,
            protect=consonant_protection, # Corresponds to 'protect' in Pipeline.voice_conversion
            sid=speaker_id_rvc,
            embedder_model="contentvec", # Make sure this is what your Pipeline expects
            export_format="WAV",
            # Add other kwargs if your VoiceConverter.convert_audio or Pipeline.pipeline expects them:
            # hop_length=128, # Example
            # volume_envelope=1.0, # Example
            # f0_autotune=False, # Example
            # clean_audio=False, # Example
        )
        
        if not os.path.exists(final_rvc_audio_filepath) or os.path.getsize(final_rvc_audio_filepath) == 0:
            print(f"[RVC] VoiceConverter.convert_audio ran but RVC output file is missing or empty: {final_rvc_audio_filepath}")
            return None
            
        print(f"[RVC] Successfully converted audio to: {final_rvc_audio_filepath}")
        return final_rvc_audio_filename
    except Exception as e_conv:
        print(f"[RVC] Error during VoiceConverter.convert_audio call: {e_conv}")
        import traceback; traceback.print_exc()
        return None
    finally:
        if os.path.exists(base_audio_filepath):
            try: os.remove(base_audio_filepath); print(f"[RVC] Cleaned up temporary base audio: {base_audio_filepath}")
            except Exception as e_del: print(f"[RVC] Error deleting temporary base audio {base_audio_filepath}: {e_del}")

def get_ollama_response(prompt, conversation_history=None):
    is_proactive_nudge = (prompt == "[USER_IS_QUIET_YUKI_PLEASE_SPEAK]")

    if not conversation_history:
        # ... (your Yuki system prompt setup) ...
        pass # This part is fine

    if is_proactive_nudge:
        print("[Ollama] Responding to proactive nudge (user was quiet).")
        # The actual prompt sent to Ollama will be the existing conversation_history.
        # If history is short, Ollama might just re-introduce itself.
        # You might want to ensure there's *some* user-like prompt if history is just the system message.
        if len(conversation_history) <= 1: # Only system prompt
             current_turn_history = conversation_history + [{"role": "user", "content": "What's on your mind?"}] # Give Ollama something to respond to
        else:
             current_turn_history = conversation_history # Let it respond to existing context
    else:
        current_turn_history = conversation_history + [{"role": "user", "content": prompt}]

    payload = {
        "model": OLLAMA_MODEL,
        "messages": current_turn_history,
        "stream": False
    }
    # ... rest of your get_ollama_response logic to call Ollama and parse tags ...
    # ... ensure the returned updated_history is based on current_turn_history + AI raw response ...

    try:
        response_ollama = requests.post(OLLAMA_API_ENDPOINT_CHAT, json=payload, timeout=60)
        response_ollama.raise_for_status()
        response_data = response_ollama.json()
        raw_message_content = response_data.get("message", {}).get("content", "").strip()

        if not raw_message_content:
            return "Oh dear, I seem to be a bit tongue-tied!", "neutral", "Idle", conversation_history

        # Defaults
        spoken_text_candidate = raw_message_content # Start with the full raw message
        emotion = "neutral"
        motion = "Idle"

        # 1. Try to parse the main emotion/motion tag at the end
        tag_match = re.search(r'\*\[\s*emotion:\s*([\w-]+)\s*;\s*motion:\s*([\w\s-]+)\s*\]\*$', raw_message_content, re.IGNORECASE)

        if tag_match:
            spoken_text_candidate = raw_message_content[:tag_match.start()].strip() # Text before the main tag
            emotion_candidate = tag_match.group(1).strip().lower()
            motion_candidate = tag_match.group(2).strip()

            valid_emotions = ["happy", "joyful", "excited", "caring", "thoughtful", "curious", "shy_blush", "neutral", "slightly_sad", "giggle"] # TODO: Customize
            if emotion_candidate in valid_emotions:
                emotion = emotion_candidate
            else:
                print(f"Warning: Yuki received unknown main emotion tag '{emotion_candidate}', defaulting to 'neutral'.")

            if motion_candidate:
                motion = motion_candidate
            else:
                print(f"Warning: Yuki received empty main motion tag for emotion '{emotion}', defaulting motion to 'Idle'.")
            
            print(f"Yuki Parsed Main Tag: Emotion='{emotion}', Motion='{motion}'")
        else:
            # No specific main tag found, spoken_text_candidate remains the raw_message_content
            print(f"No main emotion/motion tag found in Yuki's response. Using defaults for emotion/motion.")

        # 2. Now, from the spoken_text_candidate, strip out ANY remaining general *emote* tags
        #    This will clean up emotes like *giggles* or *blushes* that might be in the main text part.
        #    This regex is non-greedy `*?` to match individual tags.
        spoken_text = re.sub(r'\*.*?\*', '', spoken_text_candidate).strip()
        # Also strip any leading/trailing whitespace again and multiple spaces
        spoken_text = re.sub(r'\s{2,}', ' ', spoken_text).strip()
        
        print(f"Final Spoken Text after stripping general emotes: '{spoken_text}'")


        if not spoken_text and tag_match: # If Ollama ONLY sent the main tag, and stripping made text empty
            spoken_text = "Hehe~" 
            print("Warning: Yuki's response was only tags, or stripping emotes made text empty. Using fallback text for speech.")
        elif not spoken_text and not tag_match and raw_message_content: # If no main tag, and stripping all *...* made text empty
            spoken_text = "Hmm, what should I say?" # A more generic fallback if all text got stripped
            print("Warning: Stripping all general emotes made text empty. Using fallback text for speech.")
        
        # ... (rest of the function: append to history, return values) ...
        updated_history_for_next_turn = current_turn_history + [{"role": "assistant", "content": raw_message_content}] # Store raw with tags
        return spoken_text, emotion, motion, updated_history_for_next_turn
    except requests.exceptions.RequestException as e_req:
        print(f"Ollama API Error (RequestException) for Yuki: {e_req}")
        return "My connection to the thinking-verse is a bit staticky!", "confused", "Idle", conversation_history
    except Exception as e_ollama:
        print(f"Error with Ollama/parsing for Yuki: {e_ollama}"); import traceback; traceback.print_exc()
        return "Oopsie! My thoughts got a little tangled!", "confused", "Idle", conversation_history

# --- Flask Routes ---
@app.route('/')
def index(): return render_template('index.html')
global_chat_history = []

@app.route('/chat', methods=['POST'])
@app.route('/chat', methods=['POST'])
def chat_endpoint():
    global global_chat_history
    data = request.json
    user_input = data.get('message')

    if not user_input:
        return jsonify({'error': 'No message received'}), 400

    print(f"User (from web): {user_input}")
    ai_text, ai_emotion, ai_motion, updated_history = get_ollama_response(user_input, global_chat_history)
    global_chat_history = updated_history

    audio_url = None
    rvc_process_error = None

    # --- MODIFIED CONDITION TO ATTEMPT RVC MORE OFTEN ---
    if ai_text and ai_text.strip(): # Proceed to RVC as long as ai_text is not None and not just whitespace
        print(f"[Flask] Yuki response (or fallback): '{ai_text}'. Proceeding to RVC.")
        generated_audio_filename = generate_rvc_voice(ai_text) 
        
        if generated_audio_filename:
            filename_for_url = f'rvc_audio_cache/{generated_audio_filename}'
            audio_url = url_for('static', filename=filename_for_url)
            print(f"[Flask] Serving RVC audio from (generated URL): {audio_url}")
        else: 
            rvc_process_error = "Yuki's RVC voice generation failed."
            print(f"[Flask] {rvc_process_error}")
            # If RVC fails, we won't have an audio_url, and the frontend will use browser TTS with ai_text
    else:
        # This case should be rare if get_ollama_response always returns some string
        print(f"[Flask] ai_text is empty or None. Skipping RVC. AI Text: '{ai_text}'")
        ai_text = "I'm not sure what to say right now!" # Ensure there's some text for browser TTS
        ai_emotion = "confused" # Default emotion for this case
        ai_motion = "Idle"      # Default motion
    # --- END OF MODIFIED CONDITION ---

    response_payload = {
        'response': ai_text,
        'emotion': ai_emotion,
        'motion': ai_motion,
        'audio_url': audio_url 
    }
    if rvc_process_error:
        response_payload['rvc_error_message'] = rvc_process_error

    return jsonify(response_payload)


if __name__ == "__main__":
    # Ensure __init__.py files are in APPLIO_ROOT_DIR/rvc and APPLIO_ROOT_DIR/rvc/infer
    # This is crucial for `from rvc.infer.infer import VoiceConverter` to work.
    
    if VoiceConverter is None:
        print("FATAL: VoiceConverter class could not be imported. RVC functionality is critical and disabled. Exiting.")
        sys.exit(1) # Exit if RVC class itself is not available
    elif voice_converter_instance is None :
        print("FATAL: VoiceConverter instance could not be initialized. Check RVC dependencies, paths, and model files (like rmvpe.pt, configs). Exiting.")
        sys.exit(1) # Exit if RVC instance failed to initialize

    print(f"Attempting to connect to Ollama model '{OLLAMA_MODEL}' at '{OLLAMA_BASE_URL}'...")
    print("Starting Flask web server with Yuki (RVC integrated)...")
    app.run(debug=True, host='0.0.0.0', port=5000)