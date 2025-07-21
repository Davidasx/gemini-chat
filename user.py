import os
import json
import time
import bcrypt
from flask_login import UserMixin

USERS_FILE = 'users.json'


class User(UserMixin):
    def __init__(self, username, password_hash=None, is_admin=False, login_attempts=0, 
                 last_attempt=0, locked_until=0):
        self.id = username
        self.username = username
        self.password_hash = password_hash
        self.is_admin = is_admin
        self.login_attempts = login_attempts
        self.last_attempt = last_attempt
        self.locked_until = locked_until
    
    @staticmethod
    def get_user(username):
        users = User.load_users()
        return users.get(username)
    
    @staticmethod
    def get_by_id(user_id):
        return User.get_user(user_id)
    
    @staticmethod
    def load_users():
        if not os.path.exists(USERS_FILE):
            return {}
        
        try:
            with open(USERS_FILE, 'r') as f:
                users_data = json.load(f)
                users = {}
                for username, data in users_data.items():
                    users[username] = User(
                        username=username,
                        password_hash=data.get('password_hash'),
                        is_admin=data.get('is_admin', False),
                        login_attempts=data.get('login_attempts', 0),
                        last_attempt=data.get('last_attempt', 0),
                        locked_until=data.get('locked_until', 0)
                    )
                return users
        except (json.JSONDecodeError, IOError):
            return {}
    
    @staticmethod
    def save_users(users):
        users_data = {}
        for username, user in users.items():
            users_data[username] = {
                'password_hash': user.password_hash,
                'is_admin': user.is_admin,
                'login_attempts': user.login_attempts,
                'last_attempt': user.last_attempt,
                'locked_until': user.locked_until
            }
        
        with open(USERS_FILE, 'w') as f:
            json.dump(users_data, f, indent=2)
    
    @staticmethod
    def create_user(username, password, is_admin=False):
        users = User.load_users()
        if username in users:
            return False, "Username already exists"
        
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        users[username] = User(
            username=username,
            password_hash=password_hash,
            is_admin=is_admin
        )
        User.save_users(users)
        return True, "User created successfully"
    
    @staticmethod
    def verify_password(username, password, lockout_attempts=5, lockout_minutes=15):
        users = User.load_users()
        user = users.get(username)
        
        if not user:
            # To prevent username enumeration, process should take same time
            # whether user exists or not
            bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
            return False, "Invalid username or password"
        
        # Check if account is locked
        current_time = time.time()
        if user.locked_until > current_time:
            minutes_left = int((user.locked_until - current_time) / 60) + 1
            return False, f"Account locked. Try again in {minutes_left} minutes."
        
        # Verify password
        if bcrypt.checkpw(password.encode('utf-8'), user.password_hash.encode('utf-8')):
            # Reset login attempts on successful login
            user.login_attempts = 0
            user.last_attempt = current_time
            User.save_users(users)
            return True, "Login successful"
        else:
            # Track failed login attempts
            user.login_attempts += 1
            user.last_attempt = current_time
            
            # Lock account if too many failed attempts
            if user.login_attempts >= lockout_attempts:
                user.locked_until = current_time + (lockout_minutes * 60)
                message = f"Account locked for {lockout_minutes} minutes due to too many failed attempts."
            else:
                attempts_left = lockout_attempts - user.login_attempts
                message = f"Invalid username or password. {attempts_left} attempts remaining."
            
            User.save_users(users)
            return False, message
    
    @staticmethod
    def initialize_default_admin(username, password):
        users = User.load_users()
        if not users:
            User.create_user(username, password, is_admin=True)
            return True
        return False 