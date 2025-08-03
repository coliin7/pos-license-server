// Test script para probar el servidor de licencias
const http = require('http');

const BASE_URL = 'http://localhost:3000';  // Cambiar por tu URL de Railway cuando esté deployado

// Función para hacer requests
function makeRequest(path, callback) {
    const url = BASE_URL + path;
    console.log(`\n🧪 Probando: ${url}`);
    
    http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(data);
                console.log('✅ Respuesta:', result);
                if (callback) callback(result);
            } catch (error) {
                console.log('❌ Error parsing JSON:', data);
            }
        });
    }).on('error', (error) => {
        console.log('❌ Error de conexión:', error.message);
    });
}

// Función para hacer POST requests
function makePostRequest(path, postData, callback) {
    const url = require('url').parse(BASE_URL + path);
    const data = JSON.stringify(postData);
    
    const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };
    
    console.log(`\n🧪 POST: ${BASE_URL + path}`);
    console.log('📤 Data:', postData);
    
    const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(responseData);
                console.log('✅ Respuesta:', result);
                if (callback) callback(result);
            } catch (error) {
                console.log('❌ Error parsing JSON:', responseData);
            }
        });
    });
    
    req.on('error', (error) => {
        console.log('❌ Error de conexión:', error.message);
    });
    
    req.write(data);
    req.end();
}

// ========== TESTS ==========

console.log('🚀 INICIANDO TESTS DEL SERVIDOR DE LICENCIAS');
console.log('='.repeat(50));

// Test 1: Verificar que el servidor esté funcionando
makeRequest('/', (result) => {
    if (result && result.message) {
        console.log('✅ Servidor funcionando correctamente');
        
        // Test 2: Crear una licencia de prueba
        setTimeout(() => {
            makePostRequest('/admin/create-license', {
                type: 'unica',
                customer_email: 'test@ejemplo.com',
                customer_name: 'Usuario de Prueba'
            }, (result) => {
                if (result && result.success && result.license) {
                    const testKey = result.license.key;
                    console.log(`✅ Licencia creada: ${testKey}`);
                    
                    // Test 3: Validar la licencia recién creada
                    setTimeout(() => {
                        makeRequest(`/validate?key=${testKey}&hardware=TEST-HARDWARE-123`, (result) => {
                            if (result && result.success) {
                                console.log('✅ Validación exitosa');
                                
                                // Test 4: Intentar validar de nuevo (debería funcionar con el mismo hardware)
                                setTimeout(() => {
                                    makeRequest(`/validate?key=${testKey}&hardware=TEST-HARDWARE-123`, (result) => {
                                        if (result && result.success) {
                                            console.log('✅ Re-validación exitosa');
                                        }
                                    });
                                }, 1000);
                                
                                // Test 5: Intentar validar con hardware diferente (debería fallar)
                                setTimeout(() => {
                                    makeRequest(`/validate?key=${testKey}&hardware=OTRO-HARDWARE-456`, (result) => {
                                        if (result && !result.success && result.code === 'HARDWARE_MISMATCH') {
                                            console.log('✅ Protección de hardware funcionando');
                                        }
                                    });
                                }, 1500);
                                
                            }
                        });
                    }, 1000);
                }
            });
        }, 1000);
        
        // Test 6: Ver estadísticas
        setTimeout(() => {
            makeRequest('/admin/status', (result) => {
                if (result && result.success) {
                    console.log('✅ Dashboard funcionando');
                }
            });
        }, 3000);
        
        // Test 7: Crear licencia de suscripción
        setTimeout(() => {
            makePostRequest('/admin/create-license', {
                type: 'suscripcion',
                months: 1,
                customer_email: 'suscriptor@ejemplo.com',
                customer_name: 'Usuario Suscriptor'
            }, (result) => {
                if (result && result.success) {
                    console.log('✅ Licencia de suscripción creada');
                }
            });
        }, 4000);
        
    }
});

// Test de licencia inválida
setTimeout(() => {
    makeRequest('/validate?key=XXXX-XXXX-XXXX-XXXX&hardware=test', (result) => {
        if (result && !result.success && result.code === 'INVALID_KEY') {
            console.log('✅ Protección contra claves inválidas funcionando');
        }
    });
}, 5000);

console.log('\n⏱️  Los tests se ejecutarán en los próximos 6 segundos...');
console.log('📊 Verifica que todos muestren ✅ para confirmar que todo funciona');
