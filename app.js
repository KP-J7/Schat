class App {
    constructor() {
        this.currentScreen = 'screen-main';
        this.init();
    }

    init() {
        this.bindEvents();
        this.showScreen('screen-main');
    }

    bindEvents() {
        // Боковое меню
        document.getElementById('sidebar-toggle').addEventListener('click', () => this.toggleSidebar());
        document.getElementById('sidebar-overlay').addEventListener('click', () => this.toggleSidebar());
        
        // Навигация в боковом меню
        document.getElementById('sidebar-profile').addEventListener('click', () => {
            this.showScreen('screen-profile');
            this.toggleSidebar();
        });
        
        // Создание группы
        document.getElementById('create-group').addEventListener('click', () => {
            this.createGroup();
            this.toggleSidebar();
        });

        // Контакты
        document.getElementById('contacts').addEventListener('click', () => {
            this.showContacts();
            this.toggleSidebar();
        });

        // Настройки
        document.getElementById('settings').addEventListener('click', () => {
            this.showSettings();
            this.toggleSidebar();
        });
    }

    showScreen(screenId) {
        document.querySelectorAll('.content-container').forEach(screen => {
            screen.classList.remove('active');
        });
        
        document.getElementById(screenId).classList.add('active');
        this.currentScreen = screenId;
        
        this.updateHeader(screenId);
    }

    updateHeader(screenId) {
        const headers = document.querySelectorAll('.header');
        headers.forEach(header => header.classList.remove('active'));
        
        let activeHeader = null;
        
        switch (screenId) {
            case 'screen-main':
                activeHeader = document.getElementById('header-main');
                break;
            case 'screen-chat':
                break;
            case 'screen-profile':
                break;
        }
        
        if (activeHeader) {
            activeHeader.classList.add('active');
        }
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    }

    async createGroup() {
        const groupName = prompt('Введите название группы:');
        if (!groupName) return;

        try {
            const response = await fetch(`${window.location.origin}/api/chats`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.getToken()}`
                },
                body: JSON.stringify({
                    name: groupName,
                    type: 'group'
                })
            });

            if (response.ok) {
                const newChat = await response.json();
                alert(`Группа "${groupName}" создана!`);
                chatManager.loadChats();
                
                // Открываем новую группу
                chatManager.openChat(newChat);
            } else {
                const error = await response.json();
                alert(error.error || 'Ошибка создания группы');
            }
        } catch (error) {
            console.error('Error creating group:', error);
            alert('Ошибка соединения');
        }
    }

    showContacts() {
        alert('Функция "Контакты" в разработке');
    }

    showSettings() {
        alert('Функция "Настройки" в разработке');
    }
}

// Инициализация приложения
let auth, chatManager, app;

document.addEventListener('DOMContentLoaded', () => {
    auth = new Auth();
    chatManager = new ChatManager();
    app = new App();

    // Экспортируем для глобального доступа
    window.auth = auth;
    window.chatManager = chatManager;
    window.app = app;
});