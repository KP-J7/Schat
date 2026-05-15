class Auth {
    constructor() {
        this.currentUser = null;
        this.apiBase = window.location.origin;
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkAuth();
    }

    bindEvents() {
        document.getElementById('show-register').addEventListener('click', () => this.toggleForms());
        document.getElementById('show-login').addEventListener('click', () => this.toggleForms());
        document.getElementById('login-btn').addEventListener('click', () => this.login());
        document.getElementById('register-btn').addEventListener('click', () => this.register());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('edit-profile-btn').addEventListener('click', () => this.editProfile());

        document.getElementById('login-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });
        
        document.getElementById('register-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.register();
        });
    }

    toggleForms() {
        const loginForm = document.querySelector('.auth-form');
        const registerForm = document.querySelector('.register-form');
        
        loginForm.style.display = loginForm.style.display === 'none' ? 'block' : 'none';
        registerForm.style.display = registerForm.style.display === 'none' ? 'block' : 'none';
    }

    async login() {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        if (!username || !password) {
            alert('Заполните все поля');
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.currentUser = data.user;
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                this.showMainApp();
            } else {
                alert(data.error || 'Ошибка авторизации');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert('Ошибка соединения с сервером');
        }
    }

    async register() {
        const username = document.getElementById('register-username').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const fullname = document.getElementById('register-fullname').value;

        if (!username || !email || !password || !fullname) {
            alert('Заполните все поля');
            return;
        }

        if (username.length < 3) {
            alert('Имя пользователя должно быть не менее 3 символов');
            return;
        }

        if (password.length < 6) {
            alert('Пароль должен быть не менее 6 символов');
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/api/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    username, 
                    email, 
                    password, 
                    fullname 
                })
            });

            const data = await response.json();

            if (response.ok) {
                // Автоматически логиним пользователя после регистрации
                this.currentUser = data.user;
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                this.showMainApp();
                alert('Аккаунт успешно создан!');
            } else {
                alert(data.error || 'Ошибка регистрации');
            }
        } catch (error) {
            console.error('Register error:', error);
            alert('Ошибка соединения с сервером');
        }
    }

    checkAuth() {
        const token = localStorage.getItem('token');
        const user = localStorage.getItem('user');
        
        if (token && user) {
            try {
                this.currentUser = JSON.parse(user);
                this.showMainApp();
            } catch (error) {
                console.error('Error parsing user data:', error);
                this.logout();
            }
        } else {
            this.showAuth();
        }
    }

    showAuth() {
        document.getElementById('auth-screen').classList.add('active');
        document.getElementById('main-screen').classList.remove('active');
    }

    showMainApp() {
        document.getElementById('auth-screen').classList.remove('active');
        document.getElementById('main-screen').classList.add('active');
        
        this.updateUserInfo();
        
        // Подключаем WebSocket после авторизации
        setTimeout(() => {
            if (window.chatManager) {
                chatManager.loadChats();
                chatManager.connectWebSocket();
                
                // Автоматически открываем общий чат
                this.openGeneralChat();
            }
        }, 100);
    }
    
    async openGeneralChat() {
        try {
            const response = await fetch(`${this.apiBase}/api/chats`, {
                headers: {
                    'Authorization': `Bearer ${this.getToken()}`
                }
            });

            if (response.ok) {
                const userChats = await response.json();
                const generalChat = userChats.find(chat => chat.id === 'general-chat');
                if (generalChat) {
                    // Автоматически открываем общий чат
                    chatManager.openChat(generalChat);
                }
            }
        } catch (error) {
            console.error('Error opening general chat:', error);
        }
    }

    updateUserInfo() {
        if (!this.currentUser) return;

        const avatarText = this.currentUser.fullname 
            ? this.currentUser.fullname.split(' ').map(n => n[0]).join('').toUpperCase()
            : this.currentUser.username.substring(0, 2).toUpperCase();
        
        document.getElementById('profile-avatar').textContent = avatarText;
        document.getElementById('sidebar-avatar').textContent = avatarText;
        
        document.getElementById('profile-fullname').textContent = this.currentUser.fullname || this.currentUser.username;
        document.getElementById('profile-username').textContent = `@${this.currentUser.username}`;
        document.getElementById('sidebar-fullname').textContent = this.currentUser.fullname || this.currentUser.username;
        document.getElementById('sidebar-username').textContent = `@${this.currentUser.username}`;
        
        document.getElementById('profile-phone').textContent = this.currentUser.phone || 'Не указан';
        document.getElementById('profile-bio').textContent = this.currentUser.bio || 'Информация отсутствует';
        
        const statusElement = document.getElementById('profile-status');
        if (this.currentUser.isOnline) {
            statusElement.textContent = 'в сети';
            statusElement.className = 'status-online';
        } else {
            statusElement.textContent = 'не в сети';
            statusElement.className = 'status-offline';
        }
    }

    async editProfile() {
        const newFullname = prompt('Введите ваше имя:', this.currentUser.fullname || '');
        if (newFullname === null) return;

        const newBio = prompt('Введите информацию о себе:', this.currentUser.bio || '');
        if (newBio === null) return;

        const newPhone = prompt('Введите номер телефона:', this.currentUser.phone || '');
        if (newPhone === null) return;

        try {
            const response = await fetch(`${this.apiBase}/api/users/profile`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getToken()}`
                },
                body: JSON.stringify({
                    fullname: newFullname,
                    bio: newBio,
                    phone: newPhone
                })
            });

            if (response.ok) {
                const updatedProfile = await response.json();
                this.currentUser = { ...this.currentUser, ...updatedProfile };
                localStorage.setItem('user', JSON.stringify(this.currentUser));
                this.updateUserInfo();
                alert('Профиль обновлен!');
            } else {
                alert('Ошибка обновления профиля');
            }
        } catch (error) {
            console.error('Error updating profile:', error);
            alert('Ошибка соединения');
        }
    }

    logout() {
        if (confirm('Вы уверены, что хотите выйти?')) {
            if (window.chatManager) {
                chatManager.disconnectWebSocket();
            }
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            this.currentUser = null;
            this.showAuth();
            
            document.getElementById('login-username').value = '';
            document.getElementById('login-password').value = '';
        }
    }

    getToken() {
        return localStorage.getItem('token');
    }

    getCurrentUser() {
        return this.currentUser;
    }
}