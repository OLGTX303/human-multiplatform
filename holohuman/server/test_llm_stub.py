"""Minimal OpenAI-compatible streaming stub on the Ollama port — lets you test
the full chat->TTS->lipsync pipeline with no LLM installed.
Run: python server/test_llm_stub.py
"""
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

REPLY = "Hi there! I'm Mina, your holographic assistant. It's great to meet you. How can I help you today?"


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for ch in REPLY:
            chunk = {"choices": [{"delta": {"content": ch}}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.flush()
            time.sleep(0.03)
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print("stub LLM on http://localhost:11434/v1")
    HTTPServer(("127.0.0.1", 11434), H).serve_forever()
