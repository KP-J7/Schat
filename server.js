const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// JWT секрет
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here-change-in-production';

// Временное хранилище данных
let users = [];
let chats = [];
let messages = [];
let onlineUsers = new Map();
let userConnections = new Map();

// Создаем общий чат при запуске
function initializeGeneralChat() {
    const generalChat = {
        id: 'general-chat',
        name: 'Общий чат',
        type: 'group',
        participants: [], // Будем добавлять пользователей при регистрации
        createdBy: 'system',
        createdAt: new Date().toISOString(),
        lastMessage: {
            text: 'Добро пожаловать в общий чат!',
            timestamp: new Date().toISOString(),
            senderId: 'system'
        }
    };
    
    // Добавляем общий чат если его нет
    if (!chats.find(c => c.id === 'general-chat')) {
        chats.push(generalChat);
        console.log('Общий чат создан');
    }
}

// Создаем демо пользователя при запуске
function createDemoUser() {
    const demoPassword = bcrypt.hashSync('demo123', 10);
    users.push({
        id: 'demo-user-id',
        username: 'demo',
        email: 'demo@example.com',
        password: demoPassword,
        fullname: 'Демо Пользователь',
        phone: '+7 (999) 123-45-67',
        bio: 'Это демонстрационный аккаунт',
        isOnline: false,
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString()
    });
    console.log('Демо пользователь создан: demo/demo123');
}

createDemoUser();
initializeGeneralChat();

// Генерация ID
function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// Middleware для проверки JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Токен отсутствует' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Неверный токен' });
        }
        req.user = user;
        next();
    });
}

// WebSocket соединения
wss.on('connection', (ws, req) => {
    console.log('Новое WebSocket соединение');

    let currentUserId = null;

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleWebSocketMessage(ws, message);
        } catch (error) {
            console.error('Ошибка обработки WebSocket сообщения:', error);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket соединение закрыто для пользователя:', currentUserId);
        if (currentUserId) {
            userConnections.delete(currentUserId);
            
            // Обновляем статус пользователя
            const user = users.find(u => u.id === currentUserId);
            if (user) {
                user.isOnline = false;
                user.lastSeen = new Date().toISOString();
            }
            broadcastUserStatus(currentUserId, false);
        }
    });

    // Обработка аутентификации
    function handleWebSocketMessage(ws, message) {
    switch (message.type) {
        case 'authenticate':
            const user = users.find(u => u.id === message.userId);
            if (user) {
                currentUserId = message.userId;
                userConnections.set(message.userId, ws);
                user.isOnline = true;
                
                // Отправляем подтверждение с информацией о пользователе
                ws.send(JSON.stringify({
                    type: 'authenticated',
                    userId: message.userId,
                    user: {
                        id: user.id,
                        username: user.username,
                        fullname: user.fullname
                    }
                }));
                
                // Рассылаем статус онлайн
                broadcastUserStatus(message.userId, true);
                console.log(`Пользователь ${user.username} подключен к WebSocket`);
                
                // Отправляем последние сообщения из активных чатов
                sendRecentMessages(ws, user.id);
            }
            break;
            
        case 'send_message':
            if (!currentUserId) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Не авторизован'
                }));
                return;
            }

            const newMessage = {
                id: generateId(),
                text: message.text,
                chatId: message.chatId,
                senderId: currentUserId,
                timestamp: new Date().toISOString()
            };
            
            messages.push(newMessage);
            
            const chat = chats.find(c => c.id === message.chatId);
            if (chat) {
                chat.lastMessage = {
                    text: message.text,
                    timestamp: newMessage.timestamp,
                    senderId: currentUserId
                };
            }

            // Находим отправителя
            const sender = users.find(u => u.id === currentUserId);
            const messageWithSender = {
                ...newMessage,
                sender: sender ? {
                    id: sender.id,
                    username: sender.username,
                    fullname: sender.fullname
                } : null
            };
            
            // Рассылаем сообщение всем участникам чата
            broadcastToChatParticipants(message.chatId, messageWithSender);
            
            // Подтверждаем отправку отправителю
            ws.send(JSON.stringify({
                type: 'message_sent',
                message: messageWithSender
            }));
            break;
            
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
            
        case 'request_messages':
            if (currentUserId && message.chatId) {
                sendChatMessages(ws, message.chatId);
            }
            break;
    }
}

// Функция отправки последних сообщений при подключении
function sendRecentMessages(ws, userId) {
    // Находим чаты пользователя
    const userChats = chats.filter(chat => 
        chat.participants && chat.participants.includes(userId)
    );
    
    userChats.forEach(chat => {
        // Отправляем последние 20 сообщений из каждого чата
        const chatMessages = messages
            .filter(msg => msg.chatId === chat.id)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
            .slice(-20);
            
        // Добавляем информацию об отправителях
        const messagesWithSenders = chatMessages.map(message => {
            const sender = users.find(u => u.id === message.senderId);
            return {
                ...message,
                sender: sender ? {
                    id: sender.id,
                    username: sender.username,
                    fullname: sender.fullname
                } : null
            };
        });
        
        if (messagesWithSenders.length > 0) {
            ws.send(JSON.stringify({
                type: 'chat_messages',
                chatId: chat.id,
                messages: messagesWithSenders
            }));
        }
    });
}

// Функция отправки сообщений конкретного чата
function sendChatMessages(ws, chatId) {
    const chatMessages = messages
        .filter(msg => msg.chatId === chatId)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
    const messagesWithSenders = chatMessages.map(message => {
        const sender = users.find(u => u.id === message.senderId);
        return {
            ...message,
            sender: sender ? {
                id: sender.id,
                username: sender.username,
                fullname: sender.fullname
            } : null
        };
    });
    
    ws.send(JSON.stringify({
        type: 'chat_messages',
        chatId: chatId,
        messages: messagesWithSenders
    }));
}
});

function broadcastMessage(message) {
    const chat = chats.find(c => c.id === message.chatId);
    if (!chat) return;

    // Находим отправителя
    const sender = users.find(u => u.id === message.senderId);
    const messageWithSender = {
        ...message,
        sender: sender ? {
            id: sender.id,
            username: sender.username,
            fullname: sender.fullname
        } : null
    };

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'new_message',
                message: messageWithSender
            }));
        }
    });
}

// Функция рассылки сообщений участникам чата
function broadcastToChatParticipants(chatId, message) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat || !chat.participants) return;

    console.log(`Рассылка сообщения в чат ${chatId} для ${chat.participants.length} участников`);

    chat.participants.forEach(userId => {
        const userWs = userConnections.get(userId);
        if (userWs && userWs.readyState === WebSocket.OPEN) {
            userWs.send(JSON.stringify({
                type: 'new_message',
                message: message
            }));
            console.log(`Сообщение отправлено пользователю ${userId}`);
        }
    });
}

function broadcastUserStatus(userId, isOnline) {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    // Рассылаем статус всем подключенным пользователям
    userConnections.forEach((ws, connectedUserId) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: isOnline ? 'user_online' : 'user_offline',
                userId: userId,
                username: user.username,
                fullname: user.fullname
            }));
        }
    });
}

// API Routes

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, fullname } = req.body;

        // Валидация
        if (!username || !email || !password || !fullname) {
            return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
        }

        if (username.length < 3) {
            return res.status(400).json({ error: 'Имя пользователя должно быть не менее 3 символов' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
        }

        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Имя пользователя уже занято' });
        }

        if (users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'Email уже используется' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = {
            id: generateId(),
            username,
            email,
            password: hashedPassword,
            fullname,
            phone: '',
            bio: '',
            isOnline: true,
            lastSeen: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };

        users.push(user);

        // Добавляем пользователя в общий чат
        const generalChat = chats.find(c => c.id === 'general-chat');
        if (generalChat && !generalChat.participants.includes(user.id)) {
            generalChat.participants.push(user.id);
            console.log(`Пользователь ${username} добавлен в общий чат`);
        }

        // Создаем токен
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });

        res.status(201).json({ 
            message: 'Пользователь создан',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullname: user.fullname,
                phone: user.phone,
                bio: user.bio,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Авторизация
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        const user = users.find(u => u.username === username);
        if (!user) {
            return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });

        // Обновляем статус пользователя
        user.isOnline = true;
        user.lastSeen = new Date().toISOString();

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullname: user.fullname,
                phone: user.phone,
                bio: user.bio,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение профиля пользователя
app.get('/api/users/profile', authenticateToken, (req, res) => {
    const user = users.find(u => u.id === req.user.userId);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const { password, ...userProfile } = user;
    res.json(userProfile);
});

// Обновление профиля пользователя
app.put('/api/users/profile', authenticateToken, (req, res) => {
    const { fullname, bio, phone } = req.body;
    const user = users.find(u => u.id === req.user.userId);
    
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Обновляем поля
    if (fullname !== undefined) user.fullname = fullname;
    if (bio !== undefined) user.bio = bio;
    if (phone !== undefined) user.phone = phone;

    const { password, ...updatedProfile } = user;
    res.json(updatedProfile);
});

// Получение чатов пользователя
app.get('/api/chats', authenticateToken, (req, res) => {
    let userChats = chats.filter(chat => 
        chat.participants && chat.participants.includes(req.user.userId)
    );

    if (userChats.length === 0) {
        // Создаем общий чат с участием всех пользователей
        const allUserIds = users.map(u => u.id);
        const generalChat = {
            id: 'general-chat',
            name: 'Общий чат',
            type: 'group',
            participants: allUserIds, // Все пользователи в общем чате
            createdBy: 'system',
            createdAt: new Date().toISOString(),
            lastMessage: {
                text: 'Добро пожаловать в общий чат!',
                timestamp: new Date().toISOString(),
                senderId: 'system'
            }
        };

        // Создаем техподдержку только для текущего пользователя
        const supportChat = {
            id: `support-${req.user.userId}`,
            name: 'Техподдержка QuickChat',
            type: 'private',
            participants: [req.user.userId, 'support'],
            createdBy: 'system',
            createdAt: new Date().toISOString(),
            lastMessage: {
                text: 'Чем могу помочь?',
                timestamp: new Date().toISOString(),
                senderId: 'support'
            }
        };

        // Добавляем чаты если их еще нет
        if (!chats.find(c => c.id === generalChat.id)) {
            chats.push(generalChat);
        }
        if (!chats.find(c => c.id === supportChat.id)) {
            chats.push(supportChat);
        }
        
        userChats = [generalChat, supportChat].filter(chat => 
            chat.participants.includes(req.user.userId)
        );
    }

    res.json(userChats);
});

// Создание чата/группы
app.post('/api/chats', authenticateToken, (req, res) => {
    const { name, type = 'private', participants = [] } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Название чата обязательно' });
    }

    const chat = {
        id: generateId(),
        name,
        type,
        participants: [req.user.userId, ...participants],
        createdBy: req.user.userId,
        createdAt: new Date().toISOString(),
        lastMessage: null
    };

    chats.push(chat);
    res.status(201).json(chat);
});

// Получение сообщений чата
app.get('/api/chats/:chatId/messages', authenticateToken, async (req, res) => {
    const { chatId } = req.params;
    
    let chatMessages = messages.filter(msg => msg.chatId === chatId);
    
    // Добавляем информацию об отправителях
    const messagesWithSenders = await Promise.all(
        chatMessages.map(async (message) => {
            const sender = users.find(u => u.id === message.senderId);
            return {
                ...message,
                sender: sender ? {
                    id: sender.id,
                    username: sender.username,
                    fullname: sender.fullname
                } : null
            };
        })
    );
    
    if (messagesWithSenders.length === 0) {
        const demoMessages = [
            {
                id: generateId(),
                text: 'Добро пожаловать в QuickChat!',
                chatId: chatId,
                senderId: 'system',
                timestamp: new Date(Date.now() - 300000).toISOString(),
                sender: {
                    id: 'system',
                    username: 'system',
                    fullname: 'Система'
                }
            },
            {
                id: generateId(),
                text: 'Это демонстрация работы современного мессенджера',
                chatId: chatId,
                senderId: 'system',
                timestamp: new Date(Date.now() - 240000).toISOString(),
                sender: {
                    id: 'system',
                    username: 'system',
                    fullname: 'Система'
                }
            }
        ];
        
        demoMessages.forEach(msg => messages.push(msg));
        res.json(demoMessages);
    } else {
        res.json(messagesWithSenders);
    }
});

// Отправка сообщения
app.post('/api/chats/:chatId/messages', authenticateToken, (req, res) => {
    const { chatId } = req.params;
    const { text } = req.body;

    if (!text || text.trim() === '') {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    const message = {
        id: generateId(),
        text: text.trim(),
        chatId,
        senderId: req.user.userId,
        timestamp: new Date().toISOString()
    };

    messages.push(message);

    const chat = chats.find(c => c.id === chatId);
    if (chat) {
        chat.lastMessage = {
            text: message.text,
            timestamp: message.timestamp,
            senderId: message.senderId
        };
    }

    // Находим отправителя для немедленного возврата
    const sender = users.find(u => u.id === req.user.userId);
    const messageWithSender = {
        ...message,
        sender: sender ? {
            id: sender.id,
            username: sender.username,
            fullname: sender.fullname
        } : null
    };

    res.status(201).json(messageWithSender);
});

// Получение пользователя по ID
app.get('/api/users/:userId', authenticateToken, (req, res) => {
    const user = users.find(u => u.id === req.params.userId);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const { password, ...userProfile } = user;
    res.json(userProfile);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        users: users.length,
        chats: chats.length,
        messages: messages.length
    });
});

// Статический файл
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
    console.log('Демо аккаунт: username: demo, password: demo123');
});