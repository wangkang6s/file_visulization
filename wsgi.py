from server import app

# This is for Vercel deployment
if __name__ == "__main__":
    app.run(debug=False) 