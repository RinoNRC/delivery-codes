const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ AUTH ROUTES ============

app.post('/api/auth/register', (req, res) => {
    try {
        const { name, username, password } = req.body;
        if (!name || !username || !password) {
            return res.status(400).json({ error: 'Все поля обязательны' });
        }
        if (password.length < 4) {
            return res.status(400).json({ error: 'Пароль минимум 4 символа' });
        }
        const existing = db.findUserByUsername(username);
        if (existing) {
            return res.status(400).json({ error: 'Логин уже занят' });
        }
        const user = db.createUser(name, username, password);
        res.json({ user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const user = db.findUserByUsername(username);
        if (!user || !db.verifyPassword(password, user.password)) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        res.json({ user: { id: user.id, name: user.name, username: user.username } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/users', (req, res) => {
    try {
        res.json(db.getAllUsers());
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ ENTRIES ROUTES ============

app.get('/api/entries', (req, res) => {
    try {
        const filters = {
            userId: req.query.userId ? parseInt(req.query.userId) : null,
            code: req.query.code || null,
            startDate: req.query.startDate || null,
            endDate: req.query.endDate || null,
            search: req.query.search || null
        };
        res.json(db.getEntries(filters));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/entries', (req, res) => {
    try {
        const { userId, code, count, comment } = req.body;
        if (!userId || !code) {
            return res.status(400).json({ error: 'userId и code обязательны' });
        }
        const entry = db.createEntry(userId, code, count || 1, comment);
        res.json(entry);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.put('/api/entries/:id', (req, res) => {
    try {
        const { userId, code, count, comment } = req.body;
        const entry = db.updateEntry(parseInt(req.params.id), userId, code, count, comment);
        res.json(entry);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/api/entries/:id', (req, res) => {
    try {
        const { userId } = req.body;
        const deleted = db.deleteEntry(parseInt(req.params.id), userId);
        res.json({ success: deleted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/api/entries/today/:userId', (req, res) => {
    try {
        db.deleteUserEntriesToday(parseInt(req.params.userId));
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ============ BACKUP ROUTES ============

// Экспорт всех данных
app.get('/api/backup/export', (req, res) => {
    try {
        const data = db.exportAll();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=delivery-backup-${new Date().toISOString().split('T')[0]}.json`);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка экспорта' });
    }
});

// Импорт данных
app.post('/api/backup/import', (req, res) => {
    try {
        const { users, entries } = req.body;
        if (!users || !entries) {
            return res.status(400).json({ error: 'Неверный формат данных' });
        }
        const result = db.importAll(users, entries);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка импорта' });
    }
});

// ============ STATS ROUTES ============

// Статистика по дням
app.get('/api/stats/days', (req, res) => {
    try {
        const { startDate, endDate, userId } = req.query;
        const stats = db.getStatsByDays(startDate, endDate, userId ? parseInt(userId) : null);
        res.json(stats);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Сводка за день
app.get('/api/stats/summary/:date', (req, res) => {
    try {
        const summary = db.getDaySummary(req.params.date);
        res.json(summary);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Уведомления о новых записях
app.get('/api/notifications', (req, res) => {
    try {
        const { sinceId, userId } = req.query;
        const entries = db.getRecentEntries(parseInt(sinceId) || 0, parseInt(userId));
        res.json(entries);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Запуск
db.init().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Ошибка инициализации БД:', err);
});
