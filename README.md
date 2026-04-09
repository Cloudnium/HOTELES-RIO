# 🏨 Hoteles Rio — Sitio Web Oficial

Sitio web completo con Node.js + Express + Handlebars para Hoteles Rio.

---

## 📁 Estructura del Proyecto

```
hoteles-rio/
├── server.js                  ← Servidor principal (rutas, datos)
├── package.json
├── .env.example               ← Copia a .env y rellena tus datos
├── .gitignore
│
├── views/                     ← Páginas HTML (plantillas Handlebars)
│   ├── layouts/
│   │   └── main.hbs           ← Layout base (nav + footer en todas)
│   ├── partials/
│   │   ├── nav.hbs            ← Barra de navegación
│   │   └── footer.hbs         ← Pie de página
│   ├── inicio.hbs             ← Página INICIO
│   ├── habitaciones.hbs       ← Página HABITACIONES (lista)
│   ├── habitacion-detalle.hbs ← Página DETALLE de cada habitación
│   ├── galeria.hbs            ← Página GALERÍA
│   ├── reservas.hbs           ← Página RESERVAS
│   ├── contacto.hbs           ← Página CONTACTO
│   └── 404.hbs                ← Página de error 404
│
├── public/                    ← Archivos estáticos (CSS, JS, imágenes)
│   ├── css/
│   │   ├── variables.css      ← ⭐ COLORES, FUENTES, CONFIGURACIÓN
│   │   ├── base.css           ← Estilos globales y componentes
│   │   ├── nav.css            ← Estilos del navbar
│   │   ├── footer.css         ← Estilos del footer
│   │   └── animations.css     ← Animaciones
│   ├── js/
│   │   ├── main.js            ← JS global (navbar, scroll, fechas)
│   │   ├── galeria.js         ← Filtros y lightbox de galería
│   │   └── reservas.js        ← Lógica del formulario de reservas
│   └── images/                ← ⭐ COLOCA AQUÍ TUS IMÁGENES
│       ├── hero-inicio.jpg
│       ├── hero-habitaciones.jpg
│       ├── hero-galeria.jpg
│       ├── hero-reservas.jpg
│       ├── hero-contacto.jpg
│       ├── banner-cta.jpg
│       ├── esencia.jpg
│       ├── rooms/
│       │   ├── suite.jpg
│       │   ├── premium.jpg
│       │   └── economico.jpg
│       ├── gallery/
│       │   ├── foto1.jpg ... foto9.jpg
│       └── logos/
│           ├── logo.png        ← Logo color (nav)
│           ├── logo-white.png  ← Logo blanco (footer)
│           └── favicon.png     ← Icono del navegador (32x32px)
```

---

## 🚀 Instalación y Ejecución

### 1. Instalar dependencias
```bash
cd hoteles-rio
npm install
```

### 2. Configurar variables de entorno
```bash
# Copia el archivo ejemplo
cp .env.example .env

# Edita .env con tus datos reales (correo, teléfono, etc.)
```

### 3. Iniciar el servidor
```bash
# Producción
npm start

# Desarrollo (reinicia automáticamente al guardar cambios)
npm run dev
```

### 4. Abrir en el navegador
```
http://localhost:3000
```

---

## 🖼️ Cómo Agregar Imágenes

### Imágenes de fondo (Hero)
Coloca tus fotos en `public/images/` con estos nombres exactos:
| Archivo | Dónde se usa | Tamaño ideal |
|---------|-------------|--------------|
| `hero-inicio.jpg` | Fondo principal de INICIO | 1920 × 900px |
| `hero-habitaciones.jpg` | Fondo de HABITACIONES | 1920 × 500px |
| `hero-galeria.jpg` | Fondo de GALERÍA | 1920 × 500px |
| `hero-reservas.jpg` | Fondo de RESERVAS | 1920 × 500px |
| `hero-contacto.jpg` | Fondo de CONTACTO | 1920 × 500px |
| `banner-cta.jpg` | Banner "¿Listo para su estadía?" | 1920 × 400px |
| `esencia.jpg` | Sección "Nuestra Esencia" en inicio | 700 × 500px |

### Imágenes de habitaciones
```
public/images/rooms/suite.jpg       → Suite
public/images/rooms/premium.jpg     → Premium
public/images/rooms/economico.jpg   → Económico
```
Tamaño ideal: **800 × 600px**

### Imágenes de galería
```
public/images/gallery/foto1.jpg  ... foto9.jpg
```
Tamaño ideal: **800 × 600px**
Para agregar más fotos, edita el array `fotos` en `server.js`.

### Logo
Coloca en `public/images/logos/`:
- `logo.png` — Logo a color (navbar), fondo transparente
- `logo-white.png` — Logo blanco (footer), fondo transparente
- `favicon.png` — Ícono del navegador, **32×32px**

Para activar el logo imagen, ve a `views/partials/nav.hbs` y sigue las instrucciones de comentarios.

---

## ✏️ Qué Editar y Dónde

### Cambiar precios, habitaciones, amenidades
→ Edita el array `habitaciones` en **`server.js`** (líneas 20-80)

### Cambiar colores del sitio
→ Edita **`public/css/variables.css`**

### Cambiar textos del inicio
→ Edita **`views/inicio.hbs`**

### Cambiar fotos de la galería
→ Edita el array `fotos` en **`server.js`** (línea 84-96)

### Cambiar datos de contacto (dirección, teléfono, web)
→ Busca el comentario `<!-- DIRECCIÓN — Edita aquí -->` en:
- `views/contacto.hbs`
- `views/inicio.hbs`
- `views/partials/footer.hbs`

### Configurar envío de correos
→ Edita `.env` con tus datos de Gmail:
```
EMAIL_USER=tucorreo@gmail.com
EMAIL_PASS=contraseña_de_aplicacion_gmail
EMAIL_TO=donderecibes@correo.com
```
> Para Gmail necesitas activar "Contraseñas de aplicación" en tu cuenta Google.

### Cambiar el mapa de Google Maps
→ En `views/contacto.hbs`, busca `<iframe` y reemplaza el `src` con tu enlace de Google Maps:
1. Abre Google Maps → busca tu hotel
2. Haz clic en "Compartir" → "Insertar un mapa"
3. Copia solo el valor del atributo `src`

### Cambiar redes sociales
→ En `views/partials/footer.hbs`, reemplaza los `href="#"` con tus URLs

### Cambiar el puerto
→ En `.env`: `PORT=3000`

---

## 📦 Dependencias

| Paquete | Uso |
|---------|-----|
| express | Servidor web |
| express-handlebars | Motor de plantillas HTML |
| nodemailer | Envío de correos (formulario de contacto) |
| dotenv | Variables de entorno (.env) |
| nodemon | Reinicio automático en desarrollo |

---

## 💡 Tips

- En desarrollo usa `npm run dev` para que los cambios se apliquen automáticamente.
- Las imágenes que no existan muestran un placeholder dorado automáticamente.
- El formulario de reservas guarda los datos en consola; para persistirlos conecta una base de datos (MongoDB, PostgreSQL, etc.).
- Para subir a producción considera usar [Railway](https://railway.app), [Render](https://render.com) o un VPS con PM2.
