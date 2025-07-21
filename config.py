import os
from dotenv import load_dotenv
import secrets

# Load environment variables
load_dotenv()

# Security settings
SECRET_KEY = os.environ.get('SECRET_KEY', secrets.token_hex(32))
BCRYPT_LOG_ROUNDS = 12  # Higher means more secure but slower
DEFAULT_ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
DEFAULT_ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'changeme')  # Will be hashed on first run
LOGIN_ATTEMPTS_BEFORE_LOCKOUT = 5
LOCKOUT_TIME_MINUTES = 15
MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50 MB max upload size 