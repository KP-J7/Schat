class ChatManager {
    constructor() {
        this.currentChat = null;
        this.chats = [];
        this.apiBase = window.location.origin;
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.messageQueue = []; // Очередь для сообщений при переподключении
        this.init();
    }

    init() {
        this.bindEvents();
        // WebSocket подключится после авторизации
    }

    bindEvents() {
        // Навигация
        document.getElementById('back-to-chats').addEventListener('click', () => this.showChatList());
        document.getElementById('back-from-profile').addEventListener('click', () => this.showChatList());
        
        // Отправка сообщений
        document.getElementById('send-message').addEventListener('click', () => this.sendMessage());
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Поиск
        document.getElementById('search-toggle').addEventListener('click', () => this.toggleSearch());
        document.getElementById('chat-search').addEventListener('input', (e) => this.searchChats(e.target.value));
        
        // Вкладки чатов
        document.querySelectorAll('.chat-list-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.filterChats(e.target.dataset.tab));
        });
    }

    connectWebSocket() {
        if (!auth.getCurrentUser()) {
            console.log('WebSocket: Пользователь не авторизован');
            return;
        }

        if (this.socket) {
            this.socket.close();
        }

        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            
            console.log('Подключаемся к WebSocket:', wsUrl);
            this.socket = new WebSocket(wsUrl);
            
            this.socket.onopen = () => {
                console.log('WebSocket connected successfully');
                this.reconnectAttempts = 0;
                
                // Аутентифицируем пользователя
                this.socket.send(JSON.stringify({
                    type: 'authenticate',
                    userId: auth.getCurrentUser().id
                }));
                
                this.updateWebSocketStatus(true);
                
                // Обрабатываем сообщения из очереди
                this.processMessageQueue();
            };
            
            this.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('WebSocket message received:', data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('WebSocket message error:', error);
                }
            };
            
            this.socket.onclose = (event) => {
                console.log('WebSocket disconnected:', event.code, event.reason);
                this.updateWebSocketStatus(false);
                
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                    console.log(`WebSocket: Переподключение через ${delay}ms...`);
                    
                    setTimeout(() => {
                        this.reconnectAttempts++;
                        this.connectWebSocket();
                    }, delay);
                }
            };
            
            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateWebSocketStatus(false);
            };

            // Пинг каждые 20 секунд
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
            }
            this.pingInterval = setInterval(() => {
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify({ type: 'ping' }));
                }
            }, 20000);

        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.updateWebSocketStatus(false);
        }
    }
    
    processMessageQueue() {
        // Обрабатываем сообщения, которые пришли во время отключения
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.handleNewMessage(message);
        }
    }
    
    queueMessage(message) {
        this.messageQueue.push(message);
        // Ограничиваем очередь 50 сообщениями
        if (this.messageQueue.length > 50) {
            this.messageQueue.shift();
        }
    }

    updateWebSocketStatus(connected) {
        const statusElement = document.getElementById('ws-status');
        if (statusElement) {
            statusElement.textContent = connected ? 'Connected' : 'Disconnected';
            statusElement.style.color = connected ? '#4cd964' : '#ff3b30';
        }
    }

    disconnectWebSocket() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.updateWebSocketStatus(false);
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'authenticated':
                console.log('WebSocket authenticated for user:', data.userId);
                // Загружаем чаты после успешной аутентификации
                this.loadChats();
                break;
                
            case 'message_sent':
                console.log('Message sent confirmation:', data.message);
                // Подтверждение отправки - обновляем список чатов
                this.loadChats();
                break;
                
            case 'new_message':
                console.log('New message received:', data.message);
                this.handleNewMessage(data.message);
                break;
                
            case 'chat_messages':
                console.log('Chat messages received:', data.chatId, data.messages.length);
                this.handleChatMessages(data.chatId, data.messages);
                break;
                
            case 'user_online':
                console.log('User online:', data.userId);
                this.updateUserStatus(data.userId, true);
                break;
                
            case 'user_offline':
                console.log('User offline:', data.userId);
                this.updateUserStatus(data.userId, false);
                break;
                
            case 'pong':
                break;
                
            case 'error':
                console.error('WebSocket error:', data.message);
                break;
        }
    }

    async loadChats(forceUpdate = false) {
        try {
            const response = await fetch(`${this.apiBase}/api/chats`, {
                headers: {
                    'Authorization': `Bearer ${auth.getToken()}`
                }
            });

            if (response.ok) {
                this.chats = await response.json();
                this.renderChats();
                
                // Если нет текущего чата, открываем общий чат
                if (!this.currentChat && this.chats.length > 0) {
                    const generalChat = this.chats.find(chat => chat.id === 'general-chat');
                    if (generalChat) {
                        this.openChat(generalChat);
                    }
                }
            } else {
                console.error('Error loading chats:', response.status);
            }
        } catch (error) {
            console.error('Error loading chats:', error);
        }
    }

    renderChats() {
        const chatList = document.getElementById('chat-list');
        chatList.innerHTML = '';

        if (this.chats.length === 0) {
            chatList.innerHTML = '<div class="loading">Чатов пока нет</div>';
            return;
        }

        this.chats.forEach(chat => {
            const lastMessage = chat.lastMessage || { text: 'Нет сообщений', timestamp: new Date() };
            const time = this.formatTime(lastMessage.timestamp);
            const avatarText = chat.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

            const chatItem = document.createElement('li');
            chatItem.className = 'chat-item';
            chatItem.innerHTML = `
                <div class="chat-item-photo">${avatarText}</div>
                <div class="chat-item-info">
                    <div class="chat-item-header">
                        <span class="name">${chat.name}</span>
                        <span class="time">${time}</span>
                    </div>
                    <div class="chat-item-message">
                        <p>${lastMessage.text}</p>
                    </div>
                </div>
            `;

            chatItem.addEventListener('click', () => this.openChat(chat));
            chatList.appendChild(chatItem);
        });
    }

    async openChat(chat) {
        this.currentChat = chat;
        
        // Обновляем заголовок чата
        document.getElementById('chat-with-name').textContent = chat.name;
        document.getElementById('chat-status').textContent = 'в сети';
        document.getElementById('chat-status').className = 'status-online';
        
        // Показываем экран чата
        app.showScreen('screen-chat');
        
        // Загружаем сообщения через WebSocket если подключен
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'request_messages',
                chatId: chat.id
            }));
        } else {
            // Иначе через HTTP
            await this.loadMessages(chat.id);
        }
        
        // Фокусируемся на поле ввода
        document.getElementById('message-input').focus();
    }

    async loadMessages(chatId) {
        try {
            const response = await fetch(`${this.apiBase}/api/chats/${chatId}/messages`, {
                headers: {
                    'Authorization': `Bearer ${auth.getToken()}`
                }
            });

            if (response.ok) {
                const messages = await response.json();
                this.renderMessages(messages);
            } else {
                console.error('Error loading messages:', response.status);
                this.showErrorMessage('Ошибка загрузки сообщений');
            }
        } catch (error) {
            console.error('Error loading messages:', error);
            this.showErrorMessage('Ошибка соединения');
        }
    }

renderMessages(messages) {
    const chatMessages = document.getElementById('chat-messages');
    const loadingIndicator = document.getElementById('loading-messages');
    
    // Скрываем индикатор загрузки
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
    
    chatMessages.innerHTML = '';

    if (messages.length === 0) {
        chatMessages.innerHTML = '<div class="loading">Нет сообщений</div>';
        return;
    }

    messages.forEach(message => {
        const messageElement = this.createMessageElement(message);
        // Помечаем временные сообщения
        if (message.isTemp) {
            messageElement.classList.add('temp-message');
        }
        chatMessages.appendChild(messageElement);
    });

    // Прокручиваем вниз
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

    createMessageElement(message) {
        const container = document.createElement('div');
        const isSent = message.senderId === auth.getCurrentUser().id;
        
        container.className = `chat-message-container ${isSent ? 'sent' : 'received'}`;
        
        const time = this.formatTime(message.timestamp);
        const senderName = message.sender ? message.sender.fullname : 'Неизвестный';
        const avatarText = message.sender ? 
            message.sender.fullname.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 
            '??';

        if (isSent) {
            // Сообщения текущего пользователя - справа
            container.innerHTML = `
                <div class="chat-message-bubble">
                    ${this.escapeHtml(message.text)}
                </div>
                <div class="chat-message-time">${time}</div>
            `;
        } else {
            // Сообщения других пользователей - слева с аватаром и именем
            container.innerHTML = `
                <div class="message-sender-info">
                    <div class="message-avatar">${avatarText}</div>
                    <div class="message-content">
                        <div class="sender-name">${senderName}</div>
                        <div class="chat-message-bubble">
                            ${this.escapeHtml(message.text)}
                        </div>
                        <div class="chat-message-time">${time}</div>
                    </div>
                </div>
            `;
        }
        
        return container;
    }
    
    // Вспомогательная функция для экранирования HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    addMessageToChat(message) {
        const messageElement = this.createMessageElement(message);
        messageElement.setAttribute('data-message-id', message.id);
        document.getElementById('chat-messages').appendChild(messageElement);
        
        // Прокручиваем вниз
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async sendMessage() {
        const input = document.getElementById('message-input');
        const sendButton = document.getElementById('send-message');
        const text = input.value.trim();

        if (!text || !this.currentChat) {
            return;
        }

        // Блокируем интерфейс на время отправки
        input.disabled = true;
        sendButton.disabled = true;
        input.classList.add('sending');
        
        try {
            input.value = '';
            
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'send_message',
                    chatId: this.currentChat.id,
                    text: text
                }));
                
                // Показываем локальное сообщение сразу для лучшего UX
                const tempMessage = {
                    id: 'temp-' + Date.now(),
                    text: text,
                    chatId: this.currentChat.id,
                    senderId: auth.getCurrentUser().id,
                    timestamp: new Date().toISOString(),
                    sender: {
                        id: auth.getCurrentUser().id,
                        username: auth.getCurrentUser().username,
                        fullname: auth.getCurrentUser().fullname
                    },
                    isTemp: true
                };
                
                this.addMessageToChat(tempMessage);
                
            } else {
                // Если WebSocket не доступен, используем HTTP
                console.log('WebSocket not connected, using HTTP');
                const message = await this.sendMessageViaHTTP(text);
                this.addMessageToChat(message);
            }
            
        } catch (error) {
            console.error('Error sending message:', error);
            input.value = text; // Возвращаем текст при ошибке
            this.showErrorMessage('Ошибка отправки сообщения');
        } finally {
            input.disabled = false;
            sendButton.disabled = false;
            input.classList.remove('sending');
            input.focus();
        }
    }
    
    showErrorMessage(text) {
        // Показываем временное сообщение об ошибке
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = text;
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #ff3b30;
            color: white;
            padding: 10px 20px;
            border-radius: 10px;
            z-index: 1000;
        `;
        
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            document.body.removeChild(errorDiv);
        }, 3000);
    }

    async sendMessageViaHTTP(text) {
        const response = await fetch(`${this.apiBase}/api/chats/${this.currentChat.id}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.getToken()}`
            },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            throw new Error('HTTP send failed');
        }

        return await response.json();
    }

    handleNewMessage(message) {
        // Проверяем, не было ли уже добавлено это сообщение
        const existingMessage = document.querySelector(`[data-message-id="${message.id}"]`);
        if (existingMessage) {
            console.log('Message already exists, skipping');
            return;
        }
        
        // Если сообщение для текущего открытого чата
        if (this.currentChat && message.chatId === this.currentChat.id) {
            this.addMessageToChat(message);
        }
        
        // Обновляем список чатов для отображения последнего сообщения
        this.loadChats();
    }
    
    handleChatMessages(chatId, messages) {
        // Если это сообщения для текущего чата
        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(messages);
        }
    }

    showChatList() {
        app.showScreen('screen-main');
        this.currentChat = null;
        this.loadChats();
    }

    toggleSearch() {
        const searchContainer = document.getElementById('search-container');
        const isVisible = searchContainer.style.display === 'block';
        searchContainer.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            document.getElementById('chat-search').focus();
        }
    }

    searchChats(query) {
        const chatItems = document.querySelectorAll('.chat-item');
        const searchTerm = query.toLowerCase();
        
        chatItems.forEach(item => {
            const name = item.querySelector('.name').textContent.toLowerCase();
            const message = item.querySelector('.chat-item-message p').textContent.toLowerCase();
            
            if (name.includes(searchTerm) || message.includes(searchTerm)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    filterChats(filter) {
        document.querySelectorAll('.chat-list-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${filter}"]`).classList.add('active');
        
        // В этой версии просто показываем все чаты
        // В будущем можно добавить фильтрацию по типам
        this.renderChats();
    }

    updateUserStatus(userId, isOnline) {
        if (this.currentChat && this.currentChat.participants.includes(userId)) {
            const statusElement = document.getElementById('chat-status');
            statusElement.textContent = isOnline ? 'в сети' : 'не в сети';
            statusElement.className = isOnline ? 'status-online' : 'status-offline';
        }
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        // Для сегодняшних сообщений показываем время
        if (diff < 24 * 60 * 60 * 1000) {
            return date.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        } 
        // Для вчерашних - вчера и время
        else if (diff < 48 * 60 * 60 * 1000) {
            return `вчера в ${date.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })}`;
        }
        // Для более старых - дата и время
        else {
            return date.toLocaleDateString('ru-RU', { 
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }
}