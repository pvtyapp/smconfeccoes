from fastapi import FastAPI

app = FastAPI(title="SM Confecções API", version="0.1.0")

@app.get("/")
def root():
    return {"status": "ok", "service": "smconfeccoes-backend"}

@app.get("/health")
def health():
    return {"status": "healthy"}
