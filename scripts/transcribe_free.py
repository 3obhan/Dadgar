import sys
import os

def transcribe():
    if len(sys.argv) < 2:
        return

    audio_path = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else "fa-IR"
    if not os.path.exists(audio_path):
        return

    try:
        import speech_recognition as sr
        r = sr.Recognizer()
        r.energy_threshold = 250
        r.dynamic_energy_threshold = True
        
        with sr.AudioFile(audio_path) as source:
            audio = r.record(source)

        text = r.recognize_google(audio, language=lang)
        if text:
            print(text.strip())
    except Exception:
        pass

if __name__ == "__main__":
    transcribe()
