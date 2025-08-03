const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS para permitir requests desde tu POS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Base de datos en archivo JSON
const DB_FILE = 'licenses.json';

// Inicializar base de datos si no existe
function initDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            licenses: {},
            activations: {},
            stats: {
                total_licenses: 0,
                active_licenses: 0,
                created_at: new Date().toISOString()
            }
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
}

// Leer base de datos
function readDB() {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading database:', error);
        initDatabase();
        return readDB();
    }
}

// Escribir base de datos
function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing database:', error);
        return false;
    }
}

// Generar license key
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    
    for (let i = 0; i < 4; i++) {
        if (i > 0) result += '-';
        for (let j = 0; j < 4; j++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }
    
    return result;
}

// Generar hardware fingerprint simple
function generateHardwareFingerprint(userAgent, ip) {
    const data = userAgent + ip + Date.now();
    return crypto.createHash('md5').update(data).digest('hex').substring(0, 16);
}

// ======== ENDPOINTS ========

// Página de inicio (info del sistema)
app.get('/', (req, res) => {
    const db = readDB();
    res.json({
        message: 'Sistema de Licencias POS - Activo ✅',
        version: '1.0.0',
        stats: db.stats,
        endpoints: {
            validate: '/validate?key=XXXX-XXXX-XXXX-XXXX&hardware=abc123',
            create: '/admin/create-license',
            status: '/admin/status'
        }
    });
});

// ENDPOINT PRINCIPAL: Validar licencia
app.get('/validate', (req, res) => {
    const { key, hardware, type = 'unica' } = req.query;
    
    if (!key) {
        return res.json({ 
            success: false, 
            message: 'License key requerida',
            code: 'MISSING_KEY'
        });
    }

    const db = readDB();
    const license = db.licenses[key];

    // Verificar si la licencia existe
    if (!license) {
        return res.json({ 
            success: false, 
            message: 'Licencia no encontrada',
            code: 'INVALID_KEY'
        });
    }

    // Verificar si la licencia está activa
    if (!license.active) {
        return res.json({ 
            success: false, 
            message: 'Licencia desactivada',
            code: 'INACTIVE_LICENSE'
        });
    }

    const now = new Date();
    
    // LÓGICA PARA COMPRA ÚNICA
    if (license.type === 'unica') {
        // Si nunca se activó, activar ahora
        if (!license.activated_at) {
            license.activated_at = now.toISOString();
            license.hardware_id = hardware;
            license.last_validation = now.toISOString();
            
            // Actualizar stats
            db.stats.active_licenses++;
            
            writeDB(db);
            
            return res.json({ 
                success: true, 
                message: 'Licencia activada exitosamente',
                license_type: 'unica',
                activated_at: license.activated_at
            });
        }
        
        // Si ya está activada, verificar hardware
        if (license.hardware_id === hardware) {
            license.last_validation = now.toISOString();
            writeDB(db);
            
            return res.json({ 
                success: true, 
                message: 'Licencia válida',
                license_type: 'unica',
                activated_at: license.activated_at
            });
        } else {
            return res.json({ 
                success: false, 
                message: 'Licencia ya está en uso en otro equipo',
                code: 'HARDWARE_MISMATCH'
            });
        }
    }
    
    // LÓGICA PARA SUSCRIPCIÓN
    if (license.type === 'suscripcion') {
        const expirationDate = new Date(license.expires_at);
        
        if (now > expirationDate) {
            return res.json({ 
                success: false, 
                message: 'Suscripción expirada',
                code: 'SUBSCRIPTION_EXPIRED',
                expired_at: license.expires_at
            });
        }
        
        // Actualizar última validación
        license.last_validation = now.toISOString();
        if (!license.hardware_id) {
            license.hardware_id = hardware;
        }
        
        writeDB(db);
        
        return res.json({ 
            success: true, 
            message: 'Suscripción válida',
            license_type: 'suscripcion',
            expires_at: license.expires_at,
            days_remaining: Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24))
        });
    }

    return res.json({ 
        success: false, 
        message: 'Tipo de licencia no válido',
        code: 'INVALID_LICENSE_TYPE'
    });
});

// ======== ENDPOINTS ADMINISTRATIVOS ========

// Crear nueva licencia
app.post('/admin/create-license', (req, res) => {
    const { type = 'unica', months = 0, customer_email = '', customer_name = '' } = req.body;
    
    const db = readDB();
    const key = generateLicenseKey();
    const now = new Date();
    
    const license = {
        key: key,
        type: type,
        active: true,
        created_at: now.toISOString(),
        customer_email: customer_email,
        customer_name: customer_name,
        activated_at: null,
        hardware_id: null,
        last_validation: null
    };
    
    // Si es suscripción, agregar fecha de expiración
    if (type === 'suscripcion') {
        const expirationDate = new Date();
        expirationDate.setMonth(expirationDate.getMonth() + (months || 1));
        license.expires_at = expirationDate.toISOString();
    }
    
    db.licenses[key] = license;
    db.stats.total_licenses++;
    
    writeDB(db);
    
    res.json({ 
        success: true, 
        message: 'Licencia creada exitosamente',
        license: license
    });
});

// Ver estado del sistema
app.get('/admin/status', (req, res) => {
    const db = readDB();
    
    const stats = {
        ...db.stats,
        total_licenses: Object.keys(db.licenses).length,
        active_licenses: Object.values(db.licenses).filter(l => l.activated_at).length,
        unique_licenses: Object.values(db.licenses).filter(l => l.type === 'unica').length,
        subscription_licenses: Object.values(db.licenses).filter(l => l.type === 'suscripcion').length
    };
    
    res.json({
        success: true,
        stats: stats,
        recent_licenses: Object.values(db.licenses)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 10)
    });
});

// Listar todas las licencias
app.get('/admin/licenses', (req, res) => {
    const db = readDB();
    res.json({
        success: true,
        licenses: Object.values(db.licenses)
    });
});

// Desactivar licencia
app.post('/admin/deactivate', (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.json({ success: false, message: 'License key requerida' });
    }
    
    const db = readDB();
    
    if (!db.licenses[key]) {
        return res.json({ success: false, message: 'Licencia no encontrada' });
    }
    
    db.licenses[key].active = false;
    db.licenses[key].deactivated_at = new Date().toISOString();
    
    writeDB(db);
    
    res.json({ 
        success: true, 
        message: 'Licencia desactivada exitosamente' 
    });
});

// Inicializar base de datos al arrancar
initDatabase();

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor de licencias corriendo en puerto ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/admin/status`);
    console.log(`🔑 Validación: http://localhost:${PORT}/validate?key=XXXX-XXXX-XXXX-XXXX&hardware=abc123`);
});

// Manejo de errores
process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa rechazada:', reason);
});