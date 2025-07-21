document.addEventListener('DOMContentLoaded', () => {
    const newChatBtn = document.getElementById('new-chat-btn');
    const conversationList = document.getElementById('conversation-list');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    const sidebar = document.getElementById('sidebar');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');
    const uploadStatusArea = document.getElementById('upload-status-area');
    const modelSelectBtn = document.getElementById('model-select-btn');
    const modelDropdown = document.getElementById('model-dropdown');
    const modelOptions = document.querySelectorAll('.model-option');
    const currentChatTitle = document.getElementById('current-chat-title');

    let currentConversationId = null;
    // Track uploaded files and their status
    const uploadedFiles = new Map();
    let pendingUploads = 0;
    // 添加变量，跟踪当前响应状态和上次用户消息
    let isModelResponding = false;
    let responseController = null;
    let lastUserMessage = '';
    // 当前选择的模型，默认为flash版本
    let currentModel = 'gemini-2.5-flash';

    // --- Helper Functions ---

    function updateSendButtonState() {
        if (pendingUploads > 0) {
            sendBtn.disabled = true;
        } else {
            sendBtn.disabled = false;
        }
    }

    // --- Event Listeners ---

    newChatBtn.addEventListener('click', () => {
        const firstConv = conversationList.querySelector('.conversation-item');
        if (firstConv && firstConv.dataset.isEmpty === 'true') {
            // If the top conversation is empty, just switch to it
            switchConversation(firstConv.dataset.id);
        } else {
            // Otherwise, create a new one
            createNewChat();
        }
    });

    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const icon = toggleSidebarBtn.querySelector('i');

        // 根据侧边栏状态更新图标
        if (sidebar.classList.contains('collapsed')) {
            // 侧边栏折叠，箭头应指向右侧
            icon.classList.remove('fa-chevron-left');
            icon.classList.add('fa-chevron-right');
        } else {
            // 侧边栏展开，箭头应指向左侧
            icon.classList.remove('fa-chevron-right');
            icon.classList.add('fa-chevron-left');
        }

        // 检测是否是移动设备视图
        const isMobileView = window.innerWidth <= 768;
        if (isMobileView && !sidebar.classList.contains('collapsed')) {
            // 在移动设备上，当侧边栏展开时，点击聊天区域应该收起侧边栏
            document.getElementById('chat-container').addEventListener('click', function closeSidebarOnMobile() {
                sidebar.classList.add('collapsed');

                // 更新图标为指向右侧的箭头
                icon.classList.remove('fa-chevron-left');
                icon.classList.add('fa-chevron-right');

                // 移除事件监听器，防止重复添加
                this.removeEventListener('click', closeSidebarOnMobile);
            });
        }
    });

    // 修改事件监听处理
    sendBtn.addEventListener('click', handleSendButtonClick);

    // 提取发送按钮点击处理为单独函数
    function handleSendButtonClick() {
        // 如果模型正在响应，则停止响应
        if (isModelResponding) {
            stopResponse();
            return;
        }

        // 否则发送消息
        sendMessageFromInput();
    }

    // 提取发送消息逻辑为单独函数
    function sendMessageFromInput() {
        const message = chatInput.value.trim();

        if (message || uploadedFiles.size > 0) {
            const files = Array.from(uploadedFiles.values())
                .filter(f => f.status === 'success')
                .map(f => f.file);

            sendMessage(message, files);
            chatInput.value = '';
            // Clear uploaded files after sending
            uploadStatusArea.innerHTML = '';
            uploadedFiles.clear();
        }
    }

    // 更新Enter键处理逻辑
    chatInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!sendBtn.disabled && !isModelResponding) {
                sendMessageFromInput();
            } else if (isModelResponding) {
                stopResponse();
            }
        }
    });

    uploadBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (event) => {
        if (fileInput.files.length > 0) {
            handleFileUpload(fileInput.files);
            // Clear the input to allow selecting the same file again
            fileInput.value = '';
        }
    });

    // Handle file upload process
    function handleFileUpload(files) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileId = `file_${Date.now()}_${i}`;

            // Create upload status item
            const statusItem = document.createElement('div');
            statusItem.classList.add('upload-item');
            statusItem.dataset.fileId = fileId;

            statusItem.innerHTML = `
                <span class="upload-status pending"></span>
                <span class="upload-filename">${file.name}</span>
                <span class="upload-progress">Pending</span>
                <span class="upload-remove">&times;</span>
            `;

            // Add to status area
            uploadStatusArea.appendChild(statusItem);

            // Track this file
            uploadedFiles.set(fileId, {
                file: null,  // Will be replaced with server-side file info
                originalFile: file,
                status: 'pending',
                fileId: fileId
            });

            pendingUploads++;
            updateSendButtonState();

            // Add remove event listener
            statusItem.querySelector('.upload-remove').addEventListener('click', () => {
                if (uploadedFiles.has(fileId)) {
                    if (uploadedFiles.get(fileId).status === 'uploading') {
                        pendingUploads--;
                    }
                    uploadedFiles.delete(fileId);
                    statusItem.remove();
                    updateSendButtonState();
                }
            });

            // Start upload
            uploadFile(file, fileId);
        }
    }

    // Upload a single file to the server
    async function uploadFile(file, fileId) {
        const statusItem = document.querySelector(`.upload-item[data-file-id="${fileId}"]`);
        if (!statusItem) return;

        const statusIndicator = statusItem.querySelector('.upload-status');
        const progressText = statusItem.querySelector('.upload-progress');

        // Update UI to show uploading
        statusIndicator.classList.remove('pending');
        statusIndicator.classList.add('uploading');
        progressText.textContent = 'Uploading...';

        // Update file status
        const fileData = uploadedFiles.get(fileId);
        if (fileData) {
            fileData.status = 'uploading';
        }

        // Prepare form data
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();

            // Update UI to show success
            statusIndicator.classList.remove('uploading');
            statusIndicator.classList.add('success');
            progressText.textContent = 'Uploaded';

            // Store server file info
            if (fileData) {
                fileData.file = {
                    name: result.original_name,
                    path: result.file_uri,
                    mime_type: result.mime_type,
                    file_id: result.file_id
                };
                fileData.status = 'success';
            }
        } catch (error) {
            console.error('File upload failed:', error);

            // Update UI to show error
            statusIndicator.classList.remove('uploading');
            statusIndicator.classList.add('error');
            progressText.textContent = 'Failed';

            if (fileData) {
                fileData.status = 'error';
            }
        } finally {
            pendingUploads--;
            updateSendButtonState();
        }
    }

    chatMessages.addEventListener('click', (event) => {
        const thoughtsHeader = event.target.closest('.thoughts-header');
        if (thoughtsHeader) {
            const thoughtsContainer = thoughtsHeader.parentElement;
            const wasExpanded = thoughtsContainer.classList.contains('expanded');
            thoughtsContainer.classList.toggle('expanded');

            if (wasExpanded) {
                // If it was expanded, it's now collapsed. Scroll to bottom.
                const thoughtsContent = thoughtsContainer.querySelector('.thoughts-content');
                if (thoughtsContent) {
                    // Timeout to allow the collapse animation to finish before scrolling
                    setTimeout(() => {
                        thoughtsContent.scrollTop = thoughtsContent.scrollHeight;
                    }, 400); // Should match the transition duration in CSS
                }
            }
        }
    });

    // 模型选择按钮点击事件
    modelSelectBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        modelDropdown.classList.toggle('visible');
        // 突出显示当前选中的模型
        modelOptions.forEach(option => {
            option.classList.toggle('active', option.dataset.model === currentModel);
        });
    });

    // 模型选项点击事件
    modelOptions.forEach(option => {
        option.addEventListener('click', () => {
            currentModel = option.dataset.model;
            // 更新所有选项的active状态
            modelOptions.forEach(opt => {
                opt.classList.toggle('active', opt === option);
            });
            // 隐藏下拉菜单
            modelDropdown.classList.remove('visible');
        });
    });

    // Close menus when clicking outside
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.conversation-item')) {
            closeAllMenus();
        }
        // 点击页面其他区域时隐藏模型下拉菜单
        if (!event.target.closest('#model-select-btn') && !event.target.closest('#model-dropdown')) {
            modelDropdown.classList.remove('visible');
        }
    });

    // --- Core Functions ---

    async function loadConversations() {
        try {
            const response = await fetch('/api/conversations');
            const conversations = await response.json();
            conversationList.innerHTML = '';
            conversations.forEach(conv => {
                const convElement = document.createElement('div');
                convElement.classList.add('conversation-item');
                convElement.dataset.id = conv.id;
                convElement.dataset.isEmpty = conv.is_empty; // Store is_empty state

                let menuButtonHTML = '';
                if (!conv.is_empty) {
                    menuButtonHTML = `
                    <button class="conversation-menu-btn"><i class="fas fa-ellipsis-v"></i></button>
                    <div class="conversation-menu">
                        <button class="menu-rename-btn">Rename</button>
                        <button class="menu-delete-btn">Delete</button>
                    </div>
                    `;
                }

                // Use innerHTML to create the complex structure
                convElement.innerHTML = `
                    <span class="conversation-title">${conv.title}</span>
                    ${menuButtonHTML}
                `;

                conversationList.appendChild(convElement);
            });
            // Highlight the current conversation
            if (currentConversationId) {
                const activeItem = conversationList.querySelector(`.conversation-item[data-id="${currentConversationId}"]`);
                if (activeItem) activeItem.classList.add('active');
            }

            // If no conversation is selected, or the selected one is deleted, load the latest one
            if (!currentConversationId && conversations.length > 0) {
                switchConversation(conversations[0].id);
            } else if (conversations.length === 0) {
                // If there are no conversations, create a new one
                createNewChat();
            }
        } catch (error) {
            console.error('Failed to load conversations:', error);
        }
    }

    async function createNewChat() {
        try {
            const response = await fetch('/api/conversations', { method: 'POST' });
            const newConv = await response.json();
            await loadConversations(); // Refresh the list
            switchConversation(newConv.id);
        } catch (error) {
            console.error('Failed to create new chat:', error);
        }
    }

    function switchConversation(conversationId) {
        if (currentConversationId === conversationId) return;
        closeAllMenus();
        currentConversationId = conversationId;

        // Update active class on sidebar
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === conversationId);
        });

        loadConversation(conversationId);
    }

    conversationList.addEventListener('click', (event) => {
        const target = event.target;
        const convItem = target.closest('.conversation-item');
        if (!convItem) return;

        const conversationId = convItem.dataset.id;

        // --- Handle Menu Button Click ---
        if (target.closest('.conversation-menu-btn')) {
            event.stopPropagation(); // Prevent conv item click
            const menu = convItem.querySelector('.conversation-menu');
            const isVisible = menu.classList.contains('visible');
            closeAllMenus(); // Close others before opening
            if (!isVisible) {
                menu.classList.add('visible');
            }
            return;
        }

        // --- Handle Edit Button Click ---
        if (target.closest('.menu-rename-btn')) {
            event.stopPropagation();
            handleEditConversation(convItem);
            return;
        }

        // --- Handle Delete Button Click ---
        if (target.closest('.menu-delete-btn')) {
            event.stopPropagation();
            handleDeleteConversation(conversationId, convItem);
            return;
        }

        // If clicking on the item itself (and not a button), switch conversation
        if (target.closest('.conversation-title')) {
            switchConversation(conversationId);
        }
    });


    async function loadConversation(conversationId) {
        if (!conversationId) {
            chatMessages.innerHTML = '';
            currentChatTitle.textContent = 'New Chat';
            return;
        }
        try {
            const response = await fetch(`/api/conversations/${conversationId}`);
            const messages = await response.json();
            chatMessages.innerHTML = '';
            messages.forEach(msg => {
                let messageText = '';
                const thoughtsText = msg.thoughts || null; // Get thoughts if they exist
                const modelUsed = msg.model || null; // 获取使用的模型
                const usage = msg.usage || null; // 获取令牌使用信息

                if (msg.parts) {
                    const textParts = msg.parts.filter(p => 'text' in p);
                    const fileParts = msg.parts.filter(p => 'file_data' in p);
                    messageText = textParts.map(p => p.text).join('<br>');

                    if (fileParts.length > 0) {
                        messageText += '<br>';
                        fileParts.forEach(p => {
                            messageText += `[Attachment: ${p.file_data.mime_type}]`;
                        });
                    }
                }
                addMessageToUI(msg.role, messageText, thoughtsText, false, modelUsed, usage);
            });
            autoScroll(chatMessages);

            // 更新聊天标题
            updateCurrentChatTitle(conversationId);
        } catch (error) {
            console.error(`Failed to load conversation ${conversationId}:`, error);
        }
    }

    async function sendMessage(message, attachments = []) {
        if (!currentConversationId) {
            await createNewChat();
        }

        // 保存用户消息以备取消时使用
        lastUserMessage = message;

        // Add user message to UI immediately
        let userMessageText = message;
        if (attachments.length > 0) {
            userMessageText += '<br>' + attachments.map(f => `[Attachment: ${f.name || f.file_id}]`).join('<br>');
        }
        addMessageToUI('user', userMessageText);

        // 切换发送按钮为停止按钮
        toggleSendButtonToStop(true);

        // 创建一个可以用来取消fetch请求的控制器
        responseController = new AbortController();
        const signal = responseController.signal;

        const formData = new FormData();
        formData.append('conversation_id', currentConversationId);
        formData.append('message', message);
        formData.append('model', currentModel); // 添加当前选中的模型
        attachments.forEach(file => {
            if (file.path) {
                // For files that have been pre-uploaded
                formData.append('pre_uploaded_files', JSON.stringify({
                    path: file.path,
                    name: file.name,
                    mime_type: file.mime_type,
                    file_id: file.file_id
                }));
            } else {
                // For any direct file attachments (shouldn't happen with the new flow)
                formData.append('attachments', file);
            }
        });

        const eventSource = new EventSource(`/api/chat?${new URLSearchParams({
            conversation_id: currentConversationId
        })}`);

        let modelMessageElement = null;
        let thoughtsContentEl = null;
        let answerContentEl = null;

        fetch('/api/chat', {
            method: 'POST',
            body: formData,
            signal // 添加取消信号
        }).then(response => {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            function push() {
                reader.read().then(({ done, value }) => {
                    // 如果请求已经结束或被取消
                    if (done) {
                        console.log('Stream complete');
                        loadConversations();
                        // 恢复发送按钮状态
                        toggleSendButtonToStop(false);
                        return;
                    }
                    const chunkText = decoder.decode(value, { stream: true });
                    const events = chunkText.split('\n\n').filter(Boolean);

                    events.forEach(eventStr => {
                        if (eventStr.startsWith('data:')) {
                            const dataStr = eventStr.substring(5);
                            try {
                                const data = JSON.parse(dataStr);
                                if (data.type === 'thoughts') {
                                    if (!modelMessageElement) {
                                        modelMessageElement = addMessageToUI('model', '', 'Thinking...', true, currentModel);
                                        thoughtsContentEl = modelMessageElement.querySelector('.thoughts-content');
                                        answerContentEl = modelMessageElement.querySelector('.message-content');
                                        thoughtsContentEl.innerHTML = ''; // Clear "Thinking..." placeholder
                                    }
                                    thoughtsContentEl.innerHTML += data.content.replace(/\n/g, '<br>');
                                    autoScroll(thoughtsContentEl); // Scroll thoughts box

                                    // 更新令牌使用信息
                                    if (data.usage) {
                                        updateTokenUsage(modelMessageElement, data.usage);
                                    }

                                } else if (data.type === 'answer') {
                                    if (!modelMessageElement) {
                                        modelMessageElement = addMessageToUI('model', '', null, true, currentModel);
                                        answerContentEl = modelMessageElement.querySelector('.message-content');
                                    }
                                    answerContentEl.innerHTML += data.content.replace(/\n/g, '<br>');

                                    // 更新令牌使用信息
                                    if (data.usage) {
                                        updateTokenUsage(modelMessageElement, data.usage);
                                    }
                                } else if (data.type === 'done') {
                                    if (data.new_title) {
                                        updateConversationTitleInUI(currentConversationId, data.new_title);
                                    }

                                    // 最终更新令牌使用信息
                                    if (data.usage && modelMessageElement) {
                                        updateTokenUsage(modelMessageElement, data.usage);
                                    }
                                } else if (data.type === 'error') {
                                    console.error('Stream error:', data.content);
                                    if (answerContentEl) {
                                        answerContentEl.innerHTML += `<br><strong style="color: red;">Error: ${data.content}</strong>`;
                                    } else {
                                        addMessageToUI('model', `<strong style="color: red;">Error: ${data.content}</strong>`);
                                    }
                                }
                                autoScroll(chatMessages); // Scroll main chat window
                            } catch (e) {
                                console.error("Failed to parse stream data:", e, `Raw data: "${dataStr}"`);
                            }
                        }
                    });
                    push();
                }).catch(err => {
                    if (err.name === 'AbortError') {
                        console.log('Fetch aborted');
                    } else {
                        console.error('Error during stream reading:', err);
                    }
                    // 无论因何种原因停止，都恢复按钮状态
                    toggleSendButtonToStop(false);
                });
            }
            push();
        }).catch(error => {
            console.error('Failed to send message:', error);
            // 在出错时也恢复按钮状态
            toggleSendButtonToStop(false);
        });
    }

    // 切换发送按钮和停止按钮
    function toggleSendButtonToStop(isStop) {
        isModelResponding = isStop;

        if (isStop) {
            // 更改为停止按钮
            sendBtn.classList.add('stop-btn');
            sendBtn.innerHTML = '<div class="rotating-border"></div><i class="fas fa-square"></i>';
        } else {
            // 恢复为发送按钮
            sendBtn.classList.remove('stop-btn');
            sendBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        }
    }

    // 停止模型响应
    function stopResponse() {
        if (responseController) {
            // 取消当前的fetch请求
            responseController.abort();
            responseController = null;

            // 删除最后一个用户消息和模型响应（如果有）
            const messages = chatMessages.querySelectorAll('.message');
            const lastMessages = Array.from(messages).slice(-2); // 获取最后两条消息

            lastMessages.forEach(msg => {
                chatMessages.removeChild(msg);
            });

            // 将用户的消息文本恢复到输入框
            chatInput.value = lastUserMessage;
            lastUserMessage = '';

            // 恢复发送按钮
            toggleSendButtonToStop(false);
        }
    }

    function addMessageToUI(sender, message, thoughts = null, isStreaming = false, modelUsed = null, usage = null) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);

        let htmlContent = '';

        if (thoughts) {
            // Add 'collapsed' class by default
            htmlContent += `
                <div class="thoughts collapsed">
                    <div class="thoughts-header">Thinking...</div>
                    <div class="thoughts-content">${thoughts.replace(/\n/g, '<br>')}</div>
                </div>`;
        }

        htmlContent += `<div class="message-content">${message.replace(/\n/g, '<br>')}</div>`;

        // 如果是模型消息且有模型信息，添加模型标签
        if (sender === 'model' && modelUsed) {
            htmlContent += `<div class="message-footer">`;
            htmlContent += `<div class="model-tag">model: ${modelUsed}</div>`;

            // 如果有令牌使用信息，添加令牌标签
            if (usage) {
                const promptTokens = usage.prompt_tokens || 0;
                const completionTokens = usage.completion_tokens || 0;
                const thoughtsTokens = usage.thoughts_tokens || 0;
                htmlContent += `<div class="token-usage">tokens: ${promptTokens}/${thoughtsTokens}/${completionTokens}</div>`;
            } else if (isStreaming) {
                // 如果是流式消息，添加一个占位符，稍后更新
                htmlContent += `<div class="token-usage">tokens: 0/0/0</div>`;
            }

            htmlContent += `</div>`;
        }

        messageElement.innerHTML = htmlContent;

        chatMessages.appendChild(messageElement);
        autoScroll(chatMessages);

        // If it's a message with thoughts, find the content and scroll it to the bottom
        if (thoughts && !isStreaming) {
            const thoughtsContent = messageElement.querySelector('.thoughts-content');
            if (thoughtsContent) {
                autoScroll(thoughtsContent);
            }
        }

        return messageElement;
    }

    // 更新令牌使用信息的函数
    function updateTokenUsage(messageElement, usage) {
        const tokenUsage = messageElement.querySelector('.token-usage');
        if (tokenUsage) {
            const promptTokens = usage.prompt_tokens || 0;
            const completionTokens = usage.completion_tokens || 0;
            const thoughtsTokens = usage.thoughts_tokens || 0;
            tokenUsage.textContent = `tokens: ${promptTokens}/${thoughtsTokens}/${completionTokens}`;
        }
    }

    function autoScroll(element) {
        if (element) {
            element.scrollTop = element.scrollHeight;
        }
    }

    function closeAllMenus() {
        document.querySelectorAll('.conversation-menu.visible').forEach(menu => {
            menu.classList.remove('visible');
        });
    }

    function handleEditConversation(convItem) {
        closeAllMenus();
        const titleSpan = convItem.querySelector('.conversation-title');
        const currentTitle = titleSpan.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTitle;
        input.classList.add('title-edit-input');

        convItem.replaceChild(input, titleSpan);
        input.focus();
        input.select();

        const saveTitle = async () => {
            const newTitle = input.value.trim();
            // Revert to span first to provide immediate UI feedback
            const newTitleSpan = document.createElement('span');
            newTitleSpan.classList.add('conversation-title');
            newTitleSpan.textContent = newTitle || currentTitle; // Revert if empty
            convItem.replaceChild(newTitleSpan, input);

            if (newTitle && newTitle !== currentTitle) {
                try {
                    const response = await fetch(`/api/conversations/${convItem.dataset.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: newTitle }),
                    });
                    if (!response.ok) throw new Error('Failed to save title');

                    // 使用updateConversationTitleInUI函数同时更新侧边栏和顶部标题
                    updateConversationTitleInUI(convItem.dataset.id, newTitle);
                } catch (error) {
                    console.error(error);
                    newTitleSpan.textContent = currentTitle; // Revert on error
                }
            }
        };

        input.addEventListener('blur', saveTitle);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur(); // Triggers the blur event listener to save
            } else if (e.key === 'Escape') {
                const newTitleSpan = document.createElement('span');
                newTitleSpan.classList.add('conversation-title');
                newTitleSpan.textContent = currentTitle;
                convItem.replaceChild(newTitleSpan, input);
            }
        });
    }

    async function handleDeleteConversation(conversationId, convItem) {
        closeAllMenus();
        if (!confirm('Are you sure you want to delete this conversation?')) {
            return;
        }

        try {
            const response = await fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete');

            convItem.remove();

            if (currentConversationId === conversationId) {
                currentConversationId = null;
                chatMessages.innerHTML = '';
                const firstConv = conversationList.querySelector('.conversation-item');
                if (firstConv) {
                    switchConversation(firstConv.dataset.id);
                } else {
                    createNewChat();
                }
            }
        } catch (error) {
            console.error('Delete failed:', error);
            alert('Could not delete the conversation.');
        }
    }

    function updateConversationTitleInUI(conversationId, newTitle) {
        const convItem = conversationList.querySelector(`.conversation-item[data-id="${conversationId}"]`);
        if (convItem) {
            const titleSpan = convItem.querySelector('.conversation-title');
            if (titleSpan) titleSpan.textContent = newTitle;

            // 如果是当前对话，同时更新页面顶部的标题
            if (conversationId === currentConversationId) {
                currentChatTitle.textContent = newTitle;
            }
        }
    }

    // 添加获取和更新当前聊天标题的函数
    async function updateCurrentChatTitle(conversationId) {
        try {
            const conversations = await fetchConversationList();
            const currentConversation = conversations.find(conv => conv.id === conversationId);
            if (currentConversation) {
                currentChatTitle.textContent = currentConversation.title;
            } else {
                currentChatTitle.textContent = 'New Chat';
            }
        } catch (error) {
            console.error('Failed to update current chat title:', error);
            currentChatTitle.textContent = 'Chat';
        }
    }

    // 初始化模型选择器，设置默认选中的模型
    function initializeModelSelector() {
        // 默认选中的是flash模型
        const defaultModel = modelOptions[0];
        if (defaultModel) {
            defaultModel.classList.add('active');
            currentModel = defaultModel.dataset.model;
        }
    }

    // --- Initial Load ---
    async function initialLoad() {
        await loadConversations();

        // Initialize send button state
        updateSendButtonState();

        // Initialize model selector
        initializeModelSelector();
    }

    initialLoad();

});

// Add authentication error handling
function handleAuthenticationError(response) {
    if (response.status === 401 || response.status === 403) {
        // Redirect to login page
        window.location.href = '/login';
        return true;
    }
    return false;
}

// Modify fetch conversation list function to handle auth errors
async function fetchConversationList() {
    try {
        const response = await fetch('/api/conversations');

        // Handle authentication errors
        if (handleAuthenticationError(response)) return [];

        if (!response.ok) {
            throw new Error(`Failed to fetch conversations: ${response.status}`);
        }
        const conversations = await response.json();
        return conversations;
    } catch (error) {
        console.error('Error fetching conversations:', error);
        return [];
    }
}

// Add logout functionality
function setupLogoutButton() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            window.location.href = '/logout';
        });
    }
}

// Add admin panel link if user is admin
function setupAdminLink() {
    const adminLink = document.getElementById('admin-link');
    if (adminLink) {
        adminLink.addEventListener('click', () => {
            window.location.href = '/admin';
        });
    }
}

// 添加窗口大小变化的响应处理
function setupResponsiveHandling() {
    // 初始检查是否为移动视图
    const checkMobileView = () => {
        const isMobileView = window.innerWidth <= 768;
        document.body.classList.toggle('mobile-view', isMobileView);
    };

    // 页面加载时检查
    checkMobileView();

    // 窗口大小变化时检查
    window.addEventListener('resize', () => {
        checkMobileView();
    });
}

// Add initialization for auth-related elements
document.addEventListener('DOMContentLoaded', function () {
    // ... existing initialization code ...

    // Add auth-related setup
    setupLogoutButton();
    setupAdminLink();

    // 设置响应式处理
    setupResponsiveHandling();
}); 