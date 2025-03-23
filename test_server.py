from flask import Flask

app = Flask(__name__)

@app.route('/')
def hello():
    return "Hello, World! Test server is working."

if __name__ == "__main__":
    print("Test server starting on http://localhost:5011")
    app.run(host='localhost', port=5011, debug=False) 