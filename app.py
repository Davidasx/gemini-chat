import os
import json
import uuid
import time
import datetime
from flask import Flask, render_template, request, jsonify, Response, redirect, url_for, session, flash
from google import genai
from google.genai import types
import random
import itertools
import mimetypes
from pydantic import BaseModel
import flask_login
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from user import User
import config

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['SECRET_KEY'] = config.SECRET_KEY
app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH  # 50MB max upload

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Please log in to access this page.'

# Set up rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://",
    strategy="fixed-window"
)

# Add template filters
@app.template_filter('timestamp_to_date')
def timestamp_to_date(timestamp):
    """Convert a Unix timestamp to a formatted date string."""
    dt = datetime.datetime.fromtimestamp(timestamp)
    return dt.strftime('%Y-%m-%d %H:%M:%S')

# Add context processor to provide current time to templates
@app.context_processor
def inject_current_time():
    return {'current_time': time.time()}
    
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs('conversations', exist_ok=True)

# Load API keys from file and initialize client globally
client = None
try:
    with open(os.path.expanduser("~/.gemini_chat_keys"), 'r') as f:
        api_keys = [line.strip() for line in f if line.strip()]
    if not api_keys:
        raise ValueError("No API keys found in ~/.gemini_chat_keys")
    random.shuffle(api_keys)
    key_cycle = itertools.cycle(api_keys)
    # Initialize client with the first key, subsequent calls will rotate
    client = genai.Client(api_key=next(key_cycle))
except (FileNotFoundError, ValueError) as e:
    print(f"Error initializing API Client: {e}")
    api_keys = []
    # key_cycle will be created in the chat() function if needed
    key_cycle = itertools.cycle([None])

class Title(BaseModel):
    title: str

def generate_title(history_json):
    if not client or not api_keys:
        raise ValueError("API Client not initialized or no keys found.")
    
    # Rotate API key for each new request
    client.api_key = next(key_cycle)

    conversation_text = ""
    for message in history_json.get("history", []):
        role = message.get("role", "")
        for part in message.get("parts", []):
            if "text" in part:
                conversation_text += f"{role}: {part['text']}\n"
    
    generate_title_prompt = f"""
    This is a conversation between a user and an AI assistant.
    Please generate a title for the conversation.
    The title should capture the main topic of the conversation.
    The title should be no more than 50 characters.
    The title should be in the same language as the conversation.
    
    Conversation:
    {conversation_text}
    """
    
    response = client.models.generate_content(
        model="gemini-2.5-flash-lite-preview-06-17",
        contents=generate_title_prompt,
        config={
            "response_mime_type": "application/json",
            "response_schema": Title,
            "thinking_config": {
                "thinking_budget": 0
            }
        }
    )

    title=response.parsed.title
    return title

@login_manager.user_loader
def load_user(user_id):
    return User.get_by_id(user_id)

@app.route('/login', methods=['GET', 'POST'])
@limiter.limit("10 per minute")  # Rate limiting for login attempts
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    
    error = None
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if not username or not password:
            error = "Please provide both username and password"
        else:
            success, message = User.verify_password(
                username, 
                password, 
                lockout_attempts=config.LOGIN_ATTEMPTS_BEFORE_LOCKOUT,
                lockout_minutes=config.LOCKOUT_TIME_MINUTES
            )
            
            if success:
                user = User.get_user(username)
                login_user(user)
                return redirect(url_for('index'))
            else:
                error = message
    
    return render_template('login.html', error=error)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/api/conversations', methods=['GET'])
@login_required
def list_conversations():
    conversations = []
    for filename in os.listdir('conversations'):
        if filename.endswith('.json'):
            conversation_id = filename[:-5]
            filepath = os.path.join('conversations', filename)
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                    title = "New Chat"
                    sort_key = os.path.getmtime(filepath) # Fallback sort key

                    if isinstance(data, dict):
                        title = data.get('title', title)
                        sort_key = data.get('created_at', sort_key)
                        is_empty = not data.get('history') # Check if history is empty
                    elif isinstance(data, list) and data:
                        title = data[0].get('parts', [{}])[0].get('text', 'New Chat').split('\n')[0][:30]
                        is_empty = False # Old format implies not empty if list has content
                    else: # Handles empty list case for old format
                        is_empty = True

                    conversations.append({
                        'id': conversation_id,
                        'title': title,
                        'sort_key': sort_key,
                        'is_empty': is_empty
                    })
            except (json.JSONDecodeError, IndexError):
                conversations.append({
                    'id': conversation_id,
                    'title': 'Corrupted Chat',
                    'sort_key': os.path.getmtime(filepath),
                    'is_empty': True # Treat corrupted as empty for safety
                })
                continue

    conversations.sort(key=lambda x: x['sort_key'], reverse=True)
    
    # Remove sort_key before sending to client
    for conv in conversations:
        del conv['sort_key']
        
    return jsonify(conversations)

@app.route('/api/conversations', methods=['POST'])
@login_required
def create_conversation():
    conversation_id = str(uuid.uuid4())
    filepath = os.path.join('conversations', f"{conversation_id}.json")
    with open(filepath, 'w') as f:
        json.dump({
            'title': 'New Chat',
            'history': [],
            'created_at': time.time()
        }, f, indent=2)
    return jsonify({'id': conversation_id, 'title': 'New Chat', 'is_empty': True})

@app.route('/api/conversations/<conversation_id>', methods=['GET'])
@login_required
def get_conversation(conversation_id):
    filepath = os.path.join('conversations', f"{conversation_id}.json")
    if not os.path.exists(filepath):
        return jsonify({'error': 'Conversation not found'}), 404
    
    with open(filepath, 'r') as f:
        try:
            data = json.load(f)
            if isinstance(data, dict):
                return jsonify(data.get('history', []))
            else:
                # Fallback for old format
                return jsonify(data)
        except json.JSONDecodeError:
            return jsonify([]) # Return empty list for empty/malformed files

@app.route('/api/conversations/<conversation_id>', methods=['DELETE'])
@login_required
def delete_conversation(conversation_id):
    filepath = os.path.join('conversations', f"{conversation_id}.json")
    if os.path.exists(filepath):
        os.remove(filepath)
        return jsonify({'success': True}), 200
    return jsonify({'error': 'Conversation not found'}), 404

@app.route('/api/conversations/<conversation_id>', methods=['PUT'])
@login_required
def update_conversation_metadata(conversation_id):
    filepath = os.path.join('conversations', f"{conversation_id}.json")
    if not os.path.exists(filepath):
        return jsonify({'error': 'Conversation not found'}), 404
        
    update_data = request.get_json()
    if not update_data or 'title' not in update_data:
        return jsonify({'error': 'New title not provided'}), 400

    try:
        with open(filepath, 'r+') as f:
            data = json.load(f)
            
            if isinstance(data, list): # Migrate old format
                created_at = os.path.getmtime(filepath)
                data = {'title': 'New Chat', 'history': data, 'created_at': created_at}
            else:
                created_at = data.get('created_at', os.path.getmtime(filepath))


            data['title'] = update_data['title']
            data['created_at'] = created_at # Ensure it's preserved
            
            f.seek(0)
            f.truncate()
            json.dump(data, f, indent=2)
            
        return jsonify({'success': True, 'new_title': data['title']})
    except (json.JSONDecodeError, IOError) as e:
        return jsonify({'error': f'Failed to update conversation: {e}'}), 500


@app.route('/api/chat', methods=['POST'])
@login_required
@limiter.limit("30 per minute")  # Rate limiting for chat API
def chat():
    conversation_id = request.form.get('conversation_id')
    if not conversation_id:
        return jsonify({"error": "Missing conversation_id"}), 400

    user_message_text = request.form.get('message', '')
    files = request.files.getlist('attachments')
    pre_uploaded_files_json = request.form.getlist('pre_uploaded_files')
    
    # 获取用户选择的模型，如果没有指定则默认使用 gemini-2.5-flash
    model_name = request.form.get('model', 'gemini-2.5-flash')
    # 验证模型名称是否有效
    if model_name not in ['gemini-2.5-flash', 'gemini-2.5-pro']:
        model_name = 'gemini-2.5-flash'  # 如果无效则使用默认模型
    
    # --- Prepare message for Gemini ---
    content_parts = []
    if user_message_text:
        content_parts.append(types.Part(text=user_message_text))

    uploaded_files_info = [] # For saving to history
    
    # Process pre-uploaded files
    for pre_file_json in pre_uploaded_files_json:
        try:
            pre_file = json.loads(pre_file_json)
            filepath = pre_file.get('path')
            mime_type = pre_file.get('mime_type')
            
            if filepath and mime_type and os.path.exists(filepath):
                # For the current API call, read the saved file.
                with open(filepath, 'rb') as f_saved:
                    file_bytes = f_saved.read()

                content_parts.append(types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
                uploaded_files_info.append({'file_data': {'mime_type': mime_type, 'file_uri': filepath}})
            else:
                print(f"Warning: Pre-uploaded file not found at {filepath}. Skipping.")
        except json.JSONDecodeError as e:
            print(f"Error parsing pre-uploaded file JSON: {e}")
            continue
    
    # Process direct file uploads (should not happen with new flow, but kept for compatibility)
    for file in files:
        if file.filename:
            mime_type = file.mimetype
            # Expanded support for more types based on Gemini API capabilities
            if not mime_type or not (mime_type.startswith('image/') or mime_type.startswith('video/') or mime_type.startswith('audio/') or 'text' in mime_type or mime_type in ['application/pdf', 'application/json', 'application/zip']):
                 print(f"Warning: Unsupported file type '{mime_type}' for file '{file.filename}'. Skipping.")
                 continue

            # Save file to a unique path
            filename = f"{uuid.uuid4()}-{file.filename}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)

            # For the current API call, read the saved file.
            with open(filepath, 'rb') as f_saved:
                file_bytes = f_saved.read()

            content_parts.append(types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
            uploaded_files_info.append({'file_data': {'mime_type': mime_type, 'file_uri': filepath}})

    if not content_parts:
        return jsonify({"error": "Cannot send an empty message"}), 400

    new_user_message_save = {"role": "user", "parts": []}
    if user_message_text:
        new_user_message_save['parts'].append({'text': user_message_text})
    if uploaded_files_info:
        new_user_message_save['parts'].extend(uploaded_files_info)

    new_user_message = {"role": "user", "parts": content_parts}


    # --- Load history and call API ---
    conversation_path = os.path.join('conversations', f"{conversation_id}.json")
    history = []
    history_json = []
    current_title = "New Chat"
    created_at_time = time.time() # Default for new/malformed files

    try:
        with open(conversation_path, 'r') as f:
            data = json.load(f)
            if isinstance(data, dict):
                current_title = data.get('title', "New Chat")
                history_json = data.get('history', [])
                created_at_time = data.get('created_at', os.path.getmtime(conversation_path))
            else: # Old format
                history_json = data
                created_at_time = os.path.getmtime(conversation_path) # Get timestamp for migration

            # Reconstruct history, loading files from their URIs
            history = []
            for msg in history_json:
                if 'parts' not in msg:
                    continue
                
                processed_parts = []
                for part in msg['parts']:
                    if 'text' in part:
                        processed_parts.append(types.Part(text=part['text']))
                    elif 'file_data' in part:
                        file_info = part['file_data']
                        filepath = file_info.get('file_uri')
                        mime_type = file_info.get('mime_type')
                        if filepath and mime_type and os.path.exists(filepath):
                            try:
                                with open(filepath, 'rb') as f_hist:
                                    file_bytes = f_hist.read()
                                processed_parts.append(types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
                            except IOError as e:
                                print(f"Error reading history file {filepath}: {e}. Skipping.")
                                processed_parts.append(types.Part(text=f"[Attachment not found at {filepath}]"))
                        else:
                            print(f"Warning: file not found at {filepath}. It will be missing from history.")
                            processed_parts.append(types.Part(text=f"[Attachment not found at {filepath}]"))
                
                if processed_parts:
                    history.append(types.Content(role=msg['role'], parts=processed_parts))

    except (FileNotFoundError, json.JSONDecodeError):
        pass # Will be handled by creating new history


    def generate_response():
        try:
            if not client or not api_keys:
                raise ValueError("API Client not initialized or no keys found.")
            
            # Rotate API key for each new request
            client.api_key = next(key_cycle)

            full_response_text = ""
            full_thoughts_text = ""
            
            # 跟踪令牌使用情况
            prompt_token_count = 0
            candidates_token_count = 0
            thoughts_token_count = 0
            
            # This structure mirrors gemini.py exactly
            stream = client.models.generate_content_stream(
                model=model_name,
                contents=[*history, new_user_message],
                config=types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(
                        include_thoughts=True
                    )
                )
            )
            
            for chunk in stream:
                if not chunk.candidates:
                    continue

                if not chunk.candidates[0].content:
                    continue
                
                # 获取当前块的令牌使用信息
                if hasattr(chunk, "usage_metadata") and chunk.usage_metadata:
                    if hasattr(chunk.usage_metadata, "prompt_token_count"):
                        prompt_token_count = chunk.usage_metadata.prompt_token_count
                    if hasattr(chunk.usage_metadata, "candidates_token_count"):
                        candidates_token_count = chunk.usage_metadata.candidates_token_count
                    if hasattr(chunk.usage_metadata, "thoughts_token_count"):
                        thoughts_token_count = chunk.usage_metadata.thoughts_token_count
                
                for part in chunk.candidates[0].content.parts:
                    if not hasattr(part, 'text') or not part.text:
                        continue
                    
                    if hasattr(part, 'thought') and part.thought:
                        full_thoughts_text += part.text
                        data = json.dumps({
                            "type": "thoughts", 
                            "content": part.text,
                            "usage": {
                                "prompt_tokens": prompt_token_count,
                                "completion_tokens": candidates_token_count,
                                "thoughts_tokens": thoughts_token_count
                            }
                        })
                        yield f"data: {data}\n\n"
                    else:
                        full_response_text += part.text
                        data = json.dumps({
                            "type": "answer", 
                            "content": part.text,
                            "usage": {
                                "prompt_tokens": prompt_token_count,
                                "completion_tokens": candidates_token_count,
                                "thoughts_tokens": thoughts_token_count
                            }
                        })
                        yield f"data: {data}\n\n"

            # --- Save history after successful streaming ---
            history_json.append(new_user_message_save)
            # Save both thoughts and the final answer
            model_response = {
                "role": "model",
                "parts": [{"text": full_response_text}],
                "thoughts": full_thoughts_text,
                "model": model_name,  # 添加使用的模型信息
                "usage": {
                    "prompt_tokens": prompt_token_count,
                    "completion_tokens": candidates_token_count,
                    "thoughts_tokens": thoughts_token_count
                }
            }
            history_json.append(model_response)
            
            # Save in the new format
            with open(conversation_path, 'w') as f:
                save_data = {
                    'title': current_title,
                    'history': history_json,
                    'created_at': created_at_time
                }
                # 如果这是新对话，使用 generate_title 生成标题
                if len(history_json) == 2 and save_data['title'] == 'New Chat': # user + model
                    try:
                        save_data['title'] = generate_title(save_data)
                    except Exception as e:
                        print(f"Error generating title: {e}")
                        # 回退到使用用户消息作为标题
                        first_user_message = history_json[0].get('parts', [{}])[0].get('text', 'New Chat')
                        save_data['title'] = first_user_message.split('\n')[0][:50]

                json.dump(save_data, f, indent=2)

            # Signal end of stream
            yield f"data: {json.dumps({'type': 'done', 'new_title': save_data['title'], 'usage': {'prompt_tokens': prompt_token_count, 'completion_tokens': candidates_token_count, 'thoughts_tokens': thoughts_token_count}})}\n\n"

        except Exception as e:
            print(f"Error during Gemini API call: {e}")
            error_data = json.dumps({"type": "error", "content": str(e)})
            yield f"data: {error_data}\n\n"

    return Response(generate_response(), mimetype='text/event-stream')


@app.route('/api/upload', methods=['POST'])
@login_required
@limiter.limit("20 per minute")  # Rate limiting for file uploads
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if not file.filename:
        return jsonify({"error": "No file selected"}), 400
    
    mime_type = file.mimetype
    # Validate file type (same as in chat endpoint)
    if not mime_type or not (mime_type.startswith('image/') or mime_type.startswith('video/') or 
                           mime_type.startswith('audio/') or 'text' in mime_type or 
                           mime_type in ['application/pdf', 'application/json', 'application/zip']):
        return jsonify({"error": f"Unsupported file type: {mime_type}"}), 400
    
    # Save file with unique name
    filename = f"{uuid.uuid4()}-{file.filename}"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    
    # Return file details to client
    return jsonify({
        "success": True,
        "file_id": filename,
        "original_name": file.filename,
        "mime_type": mime_type,
        "file_uri": filepath
    })

# Admin panel routes
@app.route('/admin', methods=['GET'])
@login_required
def admin_panel():
    if not current_user.is_admin:
        return redirect(url_for('index'))
    
    users = User.load_users()
    return render_template('admin.html', users=users)

@app.route('/admin/create_user', methods=['POST'])
@login_required
def create_user():
    if not current_user.is_admin:
        return jsonify({"error": "Unauthorized"}), 403
    
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Missing username or password"}), 400
    
    is_admin = data.get('is_admin', False)
    success, message = User.create_user(data['username'], data['password'], is_admin)
    
    if success:
        return jsonify({"message": message}), 201
    else:
        return jsonify({"error": message}), 400

# Initialize the default admin user if no users exist
@app.before_request
def initialize_app():
    User.initialize_default_admin(config.DEFAULT_ADMIN_USERNAME, config.DEFAULT_ADMIN_PASSWORD)

if __name__ == '__main__':
    app.run(debug=True, port=5001) 