const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'delivery.db');

let db = null;

async function init() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }

    const SQL = await initSqlJs();
    
    // Загружаем существующую БД или создаём новую
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            count INTEGER DEFAULT 1,
            comment TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    save();
    return db;
}

function save() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

// Пользователи
function createUser(name, username, password) {
    const hash = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (name, username, password) VALUES (?, ?, ?)', [name, username, hash]);
    save();
    const result = db.exec('SELECT last_insert_rowid() as id');
    const id = Number(result[0].values[0][0]);
    return { id, name, username };
}

function findUserByUsername(username) {
    const result = db.exec('SELECT * FROM users WHERE username = ?', [username]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    const row = result[0].values[0];
    return { id: Number(row[0]), name: row[1], username: row[2], password: row[3] };
}

function verifyPassword(password, hash) {
    return bcrypt.compareSync(password, hash);
}

function getAllUsers() {
    const result = db.exec('SELECT id, name, username FROM users');
    if (result.length === 0) return [];
    return result[0].values.map(row => ({ id: row[0], name: row[1], username: row[2] }));
}


// Записи
function createEntry(userId, code, count, comment) {
    db.run('INSERT INTO entries (user_id, code, count, comment) VALUES (?, ?, ?, ?)', 
        [userId, code, count, comment || null]);
    save();
    const result = db.exec('SELECT last_insert_rowid() as id');
    const id = result[0].values[0][0];
    return getEntryById(id);
}

function getEntryById(id) {
    const result = db.exec(`
        SELECT e.id, e.user_id, e.code, e.count, e.comment, e.created_at, u.name as user_name 
        FROM entries e 
        JOIN users u ON e.user_id = u.id 
        WHERE e.id = ?
    `, [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    const row = result[0].values[0];
    return { id: row[0], user_id: row[1], code: row[2], count: row[3], comment: row[4], created_at: row[5], user_name: row[6] };
}

function updateEntry(id, userId, code, count, comment) {
    db.run('UPDATE entries SET code = ?, count = ?, comment = ? WHERE id = ? AND user_id = ?',
        [code, count, comment || null, id, userId]);
    save();
    return getEntryById(id);
}

function deleteEntry(id, userId) {
    const before = db.exec('SELECT COUNT(*) FROM entries WHERE id = ? AND user_id = ?', [id, userId]);
    const countBefore = before[0].values[0][0];
    db.run('DELETE FROM entries WHERE id = ? AND user_id = ?', [id, userId]);
    save();
    return countBefore > 0;
}

function deleteUserEntriesToday(userId) {
    const today = new Date().toISOString().split('T')[0];
    db.run(`DELETE FROM entries WHERE user_id = ? AND date(created_at) = date(?)`, [userId, today]);
    save();
    return true;
}

function getEntries(filters = {}) {
    let sql = `
        SELECT e.id, e.user_id, e.code, e.count, e.comment, e.created_at, u.name as user_name 
        FROM entries e 
        JOIN users u ON e.user_id = u.id 
        WHERE 1=1
    `;
    const params = [];

    if (filters.userId) {
        sql += ' AND e.user_id = ?';
        params.push(filters.userId);
    }
    if (filters.code) {
        sql += ' AND e.code = ?';
        params.push(filters.code);
    }
    if (filters.startDate) {
        sql += ' AND date(e.created_at) >= date(?)';
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        sql += ' AND date(e.created_at) <= date(?)';
        params.push(filters.endDate);
    }
    if (filters.search) {
        sql += ' AND e.comment LIKE ?';
        params.push(`%${filters.search}%`);
    }

    sql += ' ORDER BY e.created_at DESC';

    const result = db.exec(sql, params);
    if (result.length === 0) return [];
    
    return result[0].values.map(row => ({
        id: row[0], user_id: row[1], code: row[2], count: row[3], 
        comment: row[4], created_at: row[5], user_name: row[6]
    }));
}

// Статистика по дням за период
function getStatsByDays(startDate, endDate, userId = null) {
    let sql = `
        SELECT date(created_at) as date, code, SUM(count) as total
        FROM entries
        WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
    `;
    const params = [startDate, endDate];
    
    if (userId) {
        sql += ' AND user_id = ?';
        params.push(userId);
    }
    
    sql += ' GROUP BY date(created_at), code ORDER BY date(created_at)';
    
    const result = db.exec(sql, params);
    if (result.length === 0) return [];
    return result[0].values.map(row => ({ date: row[0], code: row[1], total: row[2] }));
}

// Сводка за день по всей бригаде
function getDaySummary(date) {
    const result = db.exec(`
        SELECT u.name, e.code, SUM(e.count) as total
        FROM entries e
        JOIN users u ON e.user_id = u.id
        WHERE date(e.created_at) = date(?)
        GROUP BY u.id, e.code
        ORDER BY u.name, e.code
    `, [date]);
    
    if (result.length === 0) return [];
    return result[0].values.map(row => ({ name: row[0], code: row[1], total: row[2] }));
}

// Последние записи для уведомлений
function getRecentEntries(sinceId, excludeUserId) {
    const result = db.exec(`
        SELECT e.id, e.code, e.count, e.created_at, u.name as user_name
        FROM entries e
        JOIN users u ON e.user_id = u.id
        WHERE e.id > ? AND e.user_id != ?
        ORDER BY e.id DESC
        LIMIT 10
    `, [sinceId, excludeUserId]);
    
    if (result.length === 0) return [];
    return result[0].values.map(row => ({
        id: Number(row[0]), code: row[1], count: row[2], created_at: row[3], user_name: row[4]
    }));
}

// Экспорт всех данных
function exportAll() {
    const users = db.exec('SELECT id, name, username, password, created_at FROM users');
    const entries = db.exec('SELECT id, user_id, code, count, comment, created_at FROM entries');
    
    return {
        version: 1,
        exportDate: new Date().toISOString(),
        users: users.length > 0 ? users[0].values.map(row => ({
            id: row[0], name: row[1], username: row[2], password: row[3], created_at: row[4]
        })) : [],
        entries: entries.length > 0 ? entries[0].values.map(row => ({
            id: row[0], user_id: row[1], code: row[2], count: row[3], comment: row[4], created_at: row[5]
        })) : []
    };
}

// Импорт данных
function importAll(users, entries) {
    let usersImported = 0;
    let entriesImported = 0;
    
    // Импорт пользователей
    users.forEach(u => {
        try {
            const existing = db.exec('SELECT id FROM users WHERE username = ?', [u.username]);
            if (existing.length === 0 || existing[0].values.length === 0) {
                db.run('INSERT INTO users (name, username, password, created_at) VALUES (?, ?, ?, ?)',
                    [u.name, u.username, u.password, u.created_at]);
                usersImported++;
            }
        } catch (e) { console.error(e); }
    });
    
    // Импорт записей
    entries.forEach(e => {
        try {
            const existing = db.exec('SELECT id FROM entries WHERE id = ?', [e.id]);
            if (existing.length === 0 || existing[0].values.length === 0) {
                db.run('INSERT INTO entries (user_id, code, count, comment, created_at) VALUES (?, ?, ?, ?, ?)',
                    [e.user_id, e.code, e.count, e.comment, e.created_at]);
                entriesImported++;
            }
        } catch (err) { console.error(err); }
    });
    
    save();
    return { usersImported, entriesImported };
}

module.exports = {
    init,
    createUser,
    findUserByUsername,
    verifyPassword,
    getAllUsers,
    createEntry,
    getEntryById,
    updateEntry,
    deleteEntry,
    deleteUserEntriesToday,
    getEntries,
    getStatsByDays,
    getDaySummary,
    getRecentEntries,
    exportAll,
    importAll
};
