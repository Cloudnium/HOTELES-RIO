// ============================================================
//  server.js — Servidor principal de Hoteles Rio
//  Para iniciar: npm start   (o npm run dev para desarrollo)
// ============================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sbServer = createClient(
  process.env.SUPABASE_URL || 'https://fqxhrpimdskvfnupjhxs.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxeGhycGltZHNrdmZudXBqaHhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyOTQ0MTksImV4cCI6MjA5MTg3MDQxOX0.08VbFHp6m5s3E5LniyMwEm61eamIM03hdIHx-gQ4jJs'
);
const express = require('express');
const { engine } = require('express-handlebars');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Motor de plantillas Handlebars ──────────────────────────
app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers: {
    eq: (a, b) => a === b,
    currentYear: () => new Date().getFullYear(),
  }
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// ── Archivos estáticos ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Datos de habitaciones ───────────────────────────────────
// EDITA aquí los precios, descripciones y amenidades
const habitaciones = [
  {
    id: 'suite',
    slug: 'suite',
    badge: 'Más Exclusiva',
    categoria: 'Categoría Superior',
    nombre: 'Suite',
    descripcionCorta: 'El refugio definitivo para quienes buscan privacidad y espacio con acabados de alta gama.',
    descripcionLarga: `Nuestra Suite es el refugio definitivo para quienes buscan privacidad y espacio. 
      Diseñada con una estética contemporánea y acabados de alta gama, cuenta con una zona de 
      descanso independiente, un área de estar pensada para la máxima relajación y vistas 
      privilegiadas al jardín.`,
    precio: 120,
    // IMAGEN: coloca tu foto en public/images/rooms/suite.jpg
    imagen: '/images/rooms/suite.jpg',
    imagenAlt: 'Habitación Suite - Hoteles Rio',
    amenidades: ['Wi-Fi gratis', 'Aire acondicionado', 'Jacuzzi', 'TV Smart', 'Minibar'],
    capacidad: '2 personas',
    camas: '1 cama'
  },
  {
    id: 'premium',
    slug: 'premium',
    badge: 'Recomendada',
    categoria: 'Categoría Alta',
    nombre: 'Premium',
    descripcionCorta: 'Ambiente superior diseñado para huéspedes que valoran los detalles y el descanso.',
    descripcionLarga: `La habitación Premium ofrece un ambiente superior, diseñado para huéspedes 
      que valoran los detalles. Con una distribución fluida y una selección de materiales premium, 
      este espacio invita al descanso profundo con todas las comodidades que usted merece.`,
    precio: 100,
    // IMAGEN: coloca tu foto en public/images/rooms/premium.jpg
    imagen: '/images/rooms/premium.jpg',
    imagenAlt: 'Habitación Premium - Hoteles Rio',
    amenidades: ['Wi-Fi gratis', 'Aire acondicionado', 'Bañera', 'TV Smart', 'Minibar'],
    capacidad: '2 personas',
    camas: '1 cama'
  },
  {
    id: 'economico',
    slug: 'economico',
    badge: null,
    categoria: 'Categoría Estándar',
    nombre: 'Económico',
    descripcionCorta: 'Confort y funcionalidad al mejor precio, sin renunciar a la calidad.',
    descripcionLarga: `Nuestra habitación Económica combina confort y funcionalidad al mejor precio. 
      Una opción inteligente que no renuncia a la calidad ni al bienestar. Perfecta para estancias 
      cortas o viajeros que priorizan la practicidad.`,
    precio: 80,
    // IMAGEN: coloca tu foto en public/images/rooms/economico.jpg
    imagen: '/images/rooms/economico.jpg',
    imagenAlt: 'Habitación Económica - Hoteles Rio',
    amenidades: ['Wi-Fi gratis', 'Aire acondicionado', 'Ducha', 'TV'],
    capacidad: '2 personas',
    camas: '1 cama'
  }
];

// ── Rutas ───────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.render('inicio', {
    title: 'Inicio',
    page: 'inicio',
    habitaciones: habitaciones.slice(0, 3)
  });
});

app.get('/habitaciones', (req, res) => {
  res.render('habitaciones', {
    title: 'Habitaciones',
    page: 'habitaciones',
    habitaciones
  });
});

app.get('/habitaciones/:slug', (req, res) => {
  const hab = habitaciones.find(h => h.slug === req.params.slug);
  if (!hab) return res.redirect('/habitaciones');
  res.render('habitacion-detalle', {
    title: hab.nombre,
    page: 'habitaciones',
    hab,
    otraHabitaciones: habitaciones.filter(h => h.slug !== hab.slug)
  });
});

app.get('/galeria', (req, res) => {
  // GALERÍA: Edita este array para agregar/quitar fotos
  // Coloca las imágenes en public/images/gallery/
  const fotos = [
    { src: '/images/gallery/foto1.png', alt: 'Exterior del hotel', categoria: 'Exterior' },
    { src: '/images/gallery/foto2.png', alt: 'Lobby principal', categoria: 'Interiores' },
    { src: '/images/gallery/foto3.png', alt: 'Habitación Suite', categoria: 'Habitaciones' },
    { src: '/images/gallery/foto4.png', alt: 'Habitación Premium', categoria: 'Habitaciones' },
    { src: '/images/gallery/foto5.png', alt: 'Jardines del hotel', categoria: 'Jardines' },
    { src: '/images/gallery/foto6.png', alt: 'Área de descanso', categoria: 'Interiores' },
    { src: '/images/gallery/foto7.png', alt: 'Baño Suite', categoria: 'Habitaciones' },
    { src: '/images/gallery/foto8.png', alt: 'Piscina', categoria: 'Instalaciones' },
    { src: '/images/gallery/foto9.png', alt: 'Estacionamiento', categoria: 'Estacionamientos' },
  ];
  res.render('galeria', {
    title: 'Galería',
    page: 'galeria',
    fotos,
    categorias: ['Todas', 'Exterior', 'Interiores', 'Habitaciones', 'Instalaciones', 'Estacionamientos', 'Jardines']
  });
});

app.get('/reservas', (req, res) => {
  res.render('reservas', {
    title: 'Reservas',
    page: 'reservas',
    habitaciones
  });
});

// POST Reservas — aquí puedes conectar con tu sistema de BD
app.post('/reservas', async (req, res) => {
  const { fecha_reserva, hora_llegada, huespedes, habitacion, nombre1, dni1, nombre2, dni2, telefono, email_cliente } = req.body;

  console.log('Nueva reserva:', req.body);

  try {
    const { data, error } = await sbServer
      .from('reservas_web')
      .insert([{
        nombre_cliente: nombre1,
        dni_cliente: dni1,
        nombre2: nombre2 || null,
        dni2: dni2 || null,
        telefono: telefono || null,
        email: email_cliente || null,
        habitacion_tipo: habitacion,
        fecha_reserva,
        hora_llegada,
        num_huespedes: parseInt(huespedes) || 1,
        estado: 'pendiente'
      }]);

    if (error) {
      console.error('❌ ERROR SUPABASE:', error);
      return res.send('Error al guardar reserva');
    }

    console.log('✅ Guardado en Supabase:', data);

    // Notificación (opcional)
    try {
  await sbServer.from('notificaciones').insert([{
    tipo: 'reserva_web',
    titulo: 'Nueva Reserva Web',
    mensaje: nombre1 + ' — ' + habitacion + ' — ' + fecha_reserva + ' ' + hora_llegada,
    leida: false,
  }]);
} catch (err) {
  console.log('⚠️ Error en notificación:', err.message);
}

    res.render('reservas', {
      title: 'Reservas',
      page: 'reservas',
      habitaciones,
      exito: true,
      datosReserva: req.body
    });

  } catch (e) {
    console.error('💥 ERROR GENERAL:', e);
    res.send('Error servidor');
  }
});

app.get('/contacto', (req, res) => {
  res.render('contacto', {
    title: 'Contacto',
    page: 'contacto'
  });
});

// POST Contacto — envía correo con nodemailer
app.post('/contacto', async (req, res) => {
  const { nombre, email, asunto, mensaje } = req.body;
  let enviado = false;
  let errorEnvio = false;

  // Guardar en Supabase SIEMPRE (antes del intento de email)
  await sbServer.from('comentarios_web').insert({ nombre, email, asunto:asunto||null, mensaje, leido:false }).catch(e=>console.error('Supabase comentario error:',e));
  await sbServer.from('notificaciones').insert({ tipo:'comentario_web', titulo:'Nuevo Mensaje Web', mensaje:nombre+': '+(asunto||mensaje.substring(0,60)), leida:false }).catch(()=>{});

  // Intentar enviar email solo si está configurado
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });
      await transporter.sendMail({
        from: `"${nombre}" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_TO || process.env.EMAIL_USER,
        subject: `[Hoteles Rio] Contacto: ${asunto || 'Sin asunto'}`,
        html: `<h2>Nuevo mensaje</h2><p><strong>Nombre:</strong> ${nombre}</p><p><strong>Email:</strong> ${email}</p><p><strong>Mensaje:</strong><br>${mensaje}</p>`
      });
      enviado = true;
    } catch (err) {
      console.error('Error enviando correo:', err.message);
      errorEnvio = false; // El mensaje ya se guardó en Supabase, no es un error crítico
    }
  } else {
    enviado = true; // Se guardó en Supabase correctamente
  }

  res.render('contacto', {
    title: 'Contacto',
    page: 'contacto',
    enviado,
    errorEnvio
  });
});


// ── Sistema de Gestión Interna ──────────────────────────────
app.get('/sistema', (req, res) => {
  res.render('sistema', {
    title: 'Sistema — Hoteles Rio',
    page: 'sistema',
    layout: 'main',
    isSistema: true
  });
});

// ── 404 ─────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { title: 'Página no encontrada', page: '' });
});

// ── Iniciar servidor ────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Hoteles Rio corriendo en http://localhost:${PORT}\n`);
});
