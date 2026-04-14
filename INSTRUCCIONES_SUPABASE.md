# 🏨 Instrucciones de Configuración — Sistema de Gestión Hoteles Rio

## PASO 1 — Crear proyecto en Supabase

1. Ve a **https://supabase.com** → Sign in / Create account
2. Click **"New project"**
3. Nombre: `hoteles-rio`
4. Elige una contraseña fuerte para la DB
5. Región: **South America (São Paulo)** — más cercano a Perú
6. Click **"Create new project"** (tarda ~2 min)

---

## PASO 2 — Ejecutar el Schema SQL

1. En tu proyecto Supabase → menú izquierdo → **SQL Editor**
2. Click **"New query"**
3. Copia TODO el contenido del archivo `SUPABASE_SCHEMA.sql`
4. Pégalo en el editor
5. Click **"Run"** (▶)
6. Deberías ver: "Success. No rows returned" — eso es correcto ✅

---

## PASO 3 — Obtener tus credenciales

1. En Supabase → **Project Settings** (ícono engranaje) → **API**
2. Copia:
   - **Project URL** → algo como `https://abcdefghij.supabase.co`
   - **anon public key** → empieza con `eyJhbGci...`

---

## PASO 4 — Configurar las credenciales en el código

Abre el archivo `public/js/sistema.js` y reemplaza las líneas:

```javascript
const SUPABASE_URL = 'https://TU_PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU_ANON_KEY_AQUI';
```

Por tus valores reales, ejemplo:
```javascript
const SUPABASE_URL = 'https://abcdefghij.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

---

## PASO 5 — Crear el primer usuario administrador

1. En Supabase → **Authentication** → **Users** → **"Add user"**
2. Email: tu correo de admin (ej: `admin@hotelrio.com`)
3. Password: contraseña segura
4. Click **"Create user"**

Luego en **SQL Editor** ejecuta esto para darle rol admin:
```sql
UPDATE usuarios SET rol = 'admin' WHERE email = 'admin@hotelrio.com';
```

### Para crear más trabajadores:
```sql
-- Opción A: Desde Supabase (Authentication → Add user)
-- Luego actualizar el rol:
UPDATE usuarios SET rol = 'recepcionista' WHERE email = 'recepcion@hotelrio.com';

-- Roles disponibles: admin, recepcionista, cajero, limpieza
```

---

## PASO 6 — Instalar dependencias y levantar el servidor

```bash
# En la carpeta del proyecto
npm install

# Para desarrollo
npm run dev

# Para producción
npm start
```

Visita: `http://localhost:3000`

El botón **"Personal"** aparece en el nav → lleva al login del sistema.

---

## PASO 7 — Deploy en producción (opcional)

Si tu web está en **Vercel** o **Railway**:

1. Sube los archivos a GitHub
2. En Vercel: importa el repositorio
3. Variables de entorno: agrega `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_TO`
4. El sistema funciona sin variables adicionales (las credenciales de Supabase están en el JS público — para mayor seguridad considera moverlas a variables de entorno)

---

## ESTRUCTURA DE TABLAS CREADAS

| Tabla | Descripción |
|-------|-------------|
| `usuarios` | Trabajadores del hotel (vinculados a auth de Supabase) |
| `habitaciones` | Registro de habitaciones con estado |
| `clientes` | Base de datos de clientes |
| `check_ins` | Registro de ingresos/salidas de huéspedes |
| `productos` | Inventario del almacén |
| `consumos_habitacion` | Productos consumidos por habitación |
| `ventas_publicas` | Ventas de la tienda al público |
| `cajas` | Cajas diarias por trabajador |
| `movimientos_caja` | Detalle de cada ingreso/egreso en caja |

---

## PERMISOS POR ROL

| Sección | Admin | Recepcionista | Cajero | Limpieza |
|---------|-------|---------------|--------|----------|
| Habitaciones | ✅ | ✅ | ✅ | ✅ (solo ver) |
| Tienda x Hab. | ✅ | ✅ | ✅ | ❌ |
| Tienda Pública | ✅ | ✅ | ✅ | ❌ |
| Almacén | ✅ | ✅ | ❌ | ❌ |
| Cajas | ✅ | ✅ | ✅ | ❌ |
| Reportes | ✅ | ✅ | ✅ | ❌ |
| Clientes | ✅ | ✅ | ✅ | ❌ |
| Usuarios | ✅ | ❌ | ❌ | ❌ |

---

## SOPORTE

Si tienes problemas, revisa la consola del navegador (F12 → Console) para ver errores de conexión con Supabase.
