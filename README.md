# gemini-chat

A secure web interface for interacting with Google's Gemini AI models.

## Features

- Chat with Gemini AI models
- Support for multiple file types (images, PDFs, etc.)
- Conversation history
- User authentication system
- Brute-force protection
- Rate limiting
- Admin panel for user management

## Security Features

- Password-based authentication
- Account lockout after multiple failed attempts (default: 5 attempts)
- Bcrypt password hashing with adequate cost factor
- Rate limiting for sensitive endpoints
- Secure session management
- Role-based access control (admin/user)

## Setup

1. Clone the repository
2. Install the dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Create a `.env` file in the project root with the following settings (see `env.sample`):
   ```
   SECRET_KEY=your_secret_key_here
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=your_secure_password
   ```

4. Create a file at `~/.gemini_chat_keys` containing your Gemini API key(s), one per line.

5. Run the application:
   ```
   python app.py
   ```

6. Visit `http://localhost:5001` in your browser.
   - Log in with the admin credentials defined in the `.env` file.
   - Use the admin panel to create additional users.

## Default Authentication

The first time the application runs, it will create an admin user with the credentials specified in your `.env` file or use the defaults:
- Username: `admin`
- Password: `changeme`

**Important**: Be sure to change the default password after first login!

## For Production Deployment

When deploying to production:

1. Use a strong, randomly generated `SECRET_KEY`
2. Set secure admin credentials in the `.env` file
3. Consider using HTTPS with a reverse proxy like Nginx
4. Consider using a production-ready WSGI server like Gunicorn
5. Set `debug=False` in the app configuration
