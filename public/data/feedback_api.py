from flask import Flask, request
import os, json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "public", "data")
os.makedirs(DATA_DIR, exist_ok=True)

FEEDBACK_PATH = os.path.join(DATA_DIR, "feedback.jsonl")

app = Flask(__name__)

@app.post("/feedback")
def receive_feedback():
    data = request.get_json(force=True, silent=True) or {}
    # Optional: basic sanity guard – ignore obviously empty payloads
    if not data:
        return {"status": "ignored", "reason": "empty payload"}, 400

    with open(FEEDBACK_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(data) + "\n")

    return {"status": "ok"}

if __name__ == "__main__":
    # Adjust port if you want
    app.run(host="0.0.0.0", port=8000, debug=True)
