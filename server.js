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
            status: '/admin/status',
            customers: '/admin/customers'
        }
    });
});

// ENDPOINT PRINCIPAL: Validar licencia (MODIFICADO PARA CAPTURAR DATOS)
app.get('/validate', (req, res) => {
    const { key, hardware, type = 'unica', customer_email, customer_phone, customer_business } = req.query;
    
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
            
            // NUEVO: Guardar datos del cliente si se proporcionan
            if (customer_email) {
                license.customer_email = customer_email;
                console.log(`📧 Email capturado: ${customer_email} para licencia: ${key}`);
            }
            if (customer_phone) {
                license.customer_phone = customer_phone;
                console.log(`📞 Teléfono capturado: ${customer_phone} para licencia: ${key}`);
            }
            if (customer_business) {
                license.customer_business = customer_business;
                console.log(`🏢 Negocio capturado: ${customer_business} para licencia: ${key}`);
            }
            
            // Actualizar stats
            db.stats.active_licenses++;
            
            writeDB(db);
            
            return res.json({ 
                success: true, 
                message: 'Licencia activada exitosamente',
                license_type: 'unica',
                activated_at: license.activated_at,
                customer_registered: !!(customer_email || customer_phone || customer_business)
            });
        }
        
        // Si ya está activada, verificar hardware
        if (license.hardware_id === hardware) {
            license.last_validation = now.toISOString();
            
            // NUEVO: Actualizar datos del cliente si se proporcionan y no existen
            let updated = false;
            if (customer_email && !license.customer_email) {
                license.customer_email = customer_email;
                updated = true;
                console.log(`📧 Email actualizado: ${customer_email} para licencia: ${key}`);
            }
            if (customer_phone && !license.customer_phone) {
                license.customer_phone = customer_phone;
                updated = true;
                console.log(`📞 Teléfono actualizado: ${customer_phone} para licencia: ${key}`);
            }
            if (customer_business && !license.customer_business) {
                license.customer_business = customer_business;
                updated = true;
                console.log(`🏢 Negocio actualizado: ${customer_business} para licencia: ${key}`);
            }
            
            if (updated) {
                writeDB(db);
            }
            
            return res.json({ 
                success: true, 
                message: 'Licencia válida',
                license_type: 'unica',
                activated_at: license.activated_at,
                customer_data: {
                    email: license.customer_email || '',
                    phone: license.customer_phone || '',
                    business: license.customer_business || ''
                }
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
        
        // NUEVO: Capturar datos del cliente para suscripciones también
        if (customer_email && !license.customer_email) {
            license.customer_email = customer_email;
            console.log(`📧 Email capturado (suscripción): ${customer_email} para licencia: ${key}`);
        }
        if (customer_phone && !license.customer_phone) {
            license.customer_phone = customer_phone;
            console.log(`📞 Teléfono capturado (suscripción): ${customer_phone} para licencia: ${key}`);
        }
        if (customer_business && !license.customer_business) {
            license.customer_business = customer_business;
            console.log(`🏢 Negocio capturado (suscripción): ${customer_business} para licencia: ${key}`);
        }
        
        writeDB(db);
        
        return res.json({ 
            success: true, 
            message: 'Suscripción válida',
            license_type: 'suscripcion',
            expires_at: license.expires_at,
            days_remaining: Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24)),
            customer_data: {
                email: license.customer_email || '',
                phone: license.customer_phone || '',
                business: license.customer_business || ''
            }
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

// NUEVO: Ver base de datos de clientes
app.get('/admin/customers', (req, res) => {
    const db = readDB();
    
    const customers = Object.values(db.licenses)
        .filter(license => license.activated_at) // Solo licencias activadas
        .map(license => ({
            license_key: license.key,
            email: license.customer_email || 'No registrado',
            phone: license.customer_phone || 'No registrado', 
            business: license.customer_business || license.customer_name || 'No registrado',
            license_type: license.type,
            activated_at: license.activated_at,
            last_validation: license.last_validation,
            hardware_id: license.hardware_id,
            expires_at: license.expires_at || null
        }))
        .sort((a, b) => new Date(b.activated_at) - new Date(a.activated_at)); // Más recientes primero
    
    res.json({
        success: true,
        total_customers: customers.length,
        customers: customers
    });
});

// Ver estado del sistema (MEJORADO)
app.get('/admin/status', (req, res) => {
    const db = readDB();
    
    const allLicenses = Object.values(db.licenses);
    const activatedLicenses = allLicenses.filter(l => l.activated_at);
    const customersWithEmail = activatedLicenses.filter(l => l.customer_email);
    const customersWithPhone = activatedLicenses.filter(l => l.customer_phone);
    const customersWithBusiness = activatedLicenses.filter(l => l.customer_business || l.customer_name);
    
    const stats = {
        ...db.stats,
        total_licenses: allLicenses.length,
        activated_licenses: activatedLicenses.length,
        unique_licenses: allLicenses.filter(l => l.type === 'unica').length,
        subscription_licenses: allLicenses.filter(l => l.type === 'suscripcion').length,
        customers_with_email: customersWithEmail.length,
        customers_with_phone: customersWithPhone.length,
        customers_with_business: customersWithBusiness.length,
        completion_rate: activatedLicenses.length > 0 ? 
            Math.round((customersWithEmail.length / activatedLicenses.length) * 100) : 0
    };
    
    res.json({
        success: true,
        stats: stats,
        recent_activations: activatedLicenses
            .sort((a, b) => new Date(b.activated_at) - new Date(a.activated_at))
            .slice(0, 10)
            .map(l => ({
                key: l.key,
                email: l.customer_email || 'No registrado',
                phone: l.customer_phone || 'No registrado',
                business: l.customer_business || l.customer_name || 'No registrado',
                activated_at: l.activated_at,
                license_type: l.type
            }))
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

// NUEVO: Exportar datos de clientes (CSV)
app.get('/admin/export-customers', (req, res) => {
    const db = readDB();
    
    const customers = Object.values(db.licenses)
        .filter(license => license.activated_at)
        .map(license => ({
            license_key: license.key,
            email: license.customer_email || '',
            phone: license.customer_phone || '',
            business: license.customer_business || license.customer_name || '',
            license_type: license.type,
            activated_at: license.activated_at,
            last_validation: license.last_validation
        }));
    
    // Generar CSV
    const csvHeaders = 'License Key,Email,Phone,Business,License Type,Activated At,Last Validation\n';
    const csvRows = customers.map(c => 
        `${c.license_key},${c.email},${c.phone},"${c.business}",${c.license_type},${c.activated_at},${c.last_validation}`
    ).join('\n');
    
    const csvContent = csvHeaders + csvRows;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="qaja_customers.csv"');
    res.send(csvContent);
});

// AGREGAR AL server.js - Sistema de Renovación Manual

// NUEVO: Renovar suscripción existente
app.post('/admin/renew-subscription', (req, res) => {
    const { key, months = 1, payment_reference = '' } = req.body;
    
    if (!key) {
        return res.json({ success: false, message: 'License key requerida' });
    }
    
    const db = readDB();
    const license = db.licenses[key];
    
    if (!license) {
        return res.json({ success: false, message: 'Licencia no encontrada' });
    }
    
    if (license.type !== 'suscripcion') {
        return res.json({ success: false, message: 'Solo se pueden renovar suscripciones' });
    }
    
    const now = new Date();
    
    // Calcular nueva fecha de expiración
    let newExpirationDate;
    if (license.expires_at && new Date(license.expires_at) > now) {
        // Si aún no expiró, extender desde la fecha actual de expiración
        newExpirationDate = new Date(license.expires_at);
    } else {
        // Si ya expiró, empezar desde hoy
        newExpirationDate = new Date();
    }
    
    newExpirationDate.setMonth(newExpirationDate.getMonth() + months);
    
    // Actualizar licencia
    license.expires_at = newExpirationDate.toISOString();
    license.last_renewal = now.toISOString();
    license.renewal_count = (license.renewal_count || 0) + 1;
    
    if (payment_reference) {
        license.payment_reference = payment_reference;
    }
    
    // Reactivar si estaba inactiva
    license.active = true;
    
    writeDB(db);
    
    console.log(`🔄 Suscripción renovada: ${key} hasta ${license.expires_at}`);
    
    res.json({
        success: true,
        message: 'Suscripción renovada exitosamente',
        license_key: key,
        new_expiration: license.expires_at,
        months_added: months,
        renewal_count: license.renewal_count
    });
});

// NUEVO: Ver suscripciones próximas a vencer
app.get('/admin/expiring-subscriptions', (req, res) => {
    const { days = 7 } = req.query; // Por defecto, próximas a vencer en 7 días
    
    const db = readDB();
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + parseInt(days));
    
    const expiring = Object.values(db.licenses)
        .filter(license => license.type === 'suscripcion')
        .filter(license => license.expires_at)
        .filter(license => {
            const expirationDate = new Date(license.expires_at);
            return expirationDate >= now && expirationDate <= futureDate;
        })
        .map(license => ({
            license_key: license.key,
            customer_email: license.customer_email || 'No registrado',
            customer_phone: license.customer_phone || 'No registrado',
            customer_business: license.customer_business || license.customer_name || 'No registrado',
            expires_at: license.expires_at,
            days_until_expiration: Math.ceil((new Date(license.expires_at) - now) / (1000 * 60 * 60 * 24)),
            activated_at: license.activated_at,
            last_validation: license.last_validation,
            renewal_count: license.renewal_count || 0
        }))
        .sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));
    
    res.json({
        success: true,
        expiring_in_days: parseInt(days),
        total_expiring: expiring.length,
        subscriptions: expiring
    });
});

// NUEVO: Ver suscripciones ya expiradas
app.get('/admin/expired-subscriptions', (req, res) => {
    const db = readDB();
    const now = new Date();
    
    const expired = Object.values(db.licenses)
        .filter(license => license.type === 'suscripcion')
        .filter(license => license.expires_at)
        .filter(license => new Date(license.expires_at) < now)
        .map(license => ({
            license_key: license.key,
            customer_email: license.customer_email || 'No registrado',
            customer_phone: license.customer_phone || 'No registrado',
            customer_business: license.customer_business || license.customer_name || 'No registrado',
            expires_at: license.expires_at,
            days_expired: Math.ceil((now - new Date(license.expires_at)) / (1000 * 60 * 60 * 24)),
            last_validation: license.last_validation,
            renewal_count: license.renewal_count || 0,
            active: license.active
        }))
        .sort((a, b) => b.days_expired - a.days_expired); // Más expiradas primero
    
    res.json({
        success: true,
        total_expired: expired.length,
        subscriptions: expired
    });
});

// NUEVO: Notificar cliente sobre vencimiento (para futuro uso con email)
app.post('/admin/notify-expiration', (req, res) => {
    const { key, notification_type = 'email' } = req.body;
    
    if (!key) {
        return res.json({ success: false, message: 'License key requerida' });
    }
    
    const db = readDB();
    const license = db.licenses[key];
    
    if (!license) {
        return res.json({ success: false, message: 'Licencia no encontrada' });
    }
    
    // Por ahora solo registrar la notificación (en futuro enviar email real)
    if (!license.notifications) {
        license.notifications = [];
    }
    
    license.notifications.push({
        type: notification_type,
        sent_at: new Date().toISOString(),
        message: 'Recordatorio de renovación de suscripción'
    });
    
    writeDB(db);
    
    console.log(`📧 Notificación registrada para ${key}: ${license.customer_email}`);
    
    res.json({
        success: true,
        message: 'Notificación registrada',
        customer_email: license.customer_email,
        customer_phone: license.customer_phone,
        notification_count: license.notifications.length
    });
});

// NUEVO: Buscar cliente por email o teléfono
app.get('/admin/search-customer', (req, res) => {
    const { query } = req.query;
    
    if (!query) {
        return res.json({ success: false, message: 'Query requerido' });
    }
    
    const db = readDB();
    const searchTerm = query.toLowerCase();
    
    const results = Object.values(db.licenses)
        .filter(license => license.activated_at)
        .filter(license => 
            (license.customer_email && license.customer_email.toLowerCase().includes(searchTerm)) ||
            (license.customer_phone && license.customer_phone.includes(searchTerm)) ||
            (license.customer_business && license.customer_business.toLowerCase().includes(searchTerm)) ||
            (license.customer_name && license.customer_name.toLowerCase().includes(searchTerm)) ||
            license.key.includes(searchTerm.toUpperCase())
        )
        .map(license => ({
            license_key: license.key,
            email: license.customer_email || 'No registrado',
            phone: license.customer_phone || 'No registrado',
            business: license.customer_business || license.customer_name || 'No registrado',
            license_type: license.type,
            activated_at: license.activated_at,
            last_validation: license.last_validation
        }));
    
    res.json({
        success: true,
        query: query,
        results_count: results.length,
        results: results
    });
});

// Inicializar base de datos al arrancar
initDatabase();

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor de licencias corriendo en puerto ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/admin/status`);
    console.log(`👥 Clientes: http://localhost:${PORT}/admin/customers`);
    console.log(`🔑 Validación: http://localhost:${PORT}/validate?key=XXXX-XXXX-XXXX-XXXX&hardware=abc123`);
});

// Manejo de errores
process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa rechazada:', reason);
});
