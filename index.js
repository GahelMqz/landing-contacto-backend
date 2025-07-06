require('dotenv').config()
const express = require('express')
const cors = require('cors')
const mysql = require('mysql2/promise')
const Joi = require('joi')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const verifyToken = require('../server/middleware/verifyToken')
const router = express.Router()

const app = express()
const port = process.env.PORT || '3001'

app.use(cors())
app.use(express.json())

// Configuración de conexión
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

const contactoSchema = Joi.object({
  fullName: Joi.string().min(3).max(100).trim().required(),
  email: Joi.string().email().required(),
  phone: Joi.string()
    .pattern(/^[0-9+\s()-]{7,20}$/)
    .required(),
  msg: Joi.string().min(5).max(1000).trim().required(),
  captcha: Joi.string().required(),
})

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))

app.post('/api/contacto', async (req, res) => {
  // Validación con Joi
  const { error, value } = contactoSchema.validate(req.body, { abortEarly: false })
  if (error) {
    return res.status(400).json({
      error: 'Datos inválidos',
      details: error.details.map((d) => d.message),
    })
  }

  const { fullName, email, phone, msg, captcha } = value

  // Verificación del CAPTCHA
  const secret = process.env.RECAPTCHA_SECRET_KEY
  const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${captcha}`

  try {
    // ⚠️ IMPORTANTE: Si usas Node < 18, necesitas importar fetch (o usa axios)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))

    const response = await fetch(verifyUrl, { method: 'POST' })
    const data = await response.json()

    if (!data.success) {
      return res.status(400).json({ error: 'Captcha inválido' })
    }

    // CAPTCHA válido, guarda en BD
    const sql = `
      INSERT INTO contactos (fullName, email, phone, msg)
      VALUES (?, ?, ?, ?)
    `
    await pool.execute(sql, [fullName, email, phone, msg])

    res.status(200).json({ message: 'Mensaje guardado correctamente' })
  } catch (error) {
    console.error('❌ Error al guardar contacto:', error)
    res.status(500).json({ error: 'Error del servidor' })
  }
})

app.post('/api/register', async (req, res) => {
  const { fullName, email, pass } = req.body
  try {
    const [existingUsers] = await pool.execute('SELECT id_user FROM users WHERE email = ?', [email])

    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'El correo ya está registrado' })
    }

    const hashedPassword = await bcrypt.hash(pass, 10)

    const sql = `
      INSERT INTO users (fullName, email, pass)
      VALUES (?, ?, ?)
    `
    await pool.execute(sql, [fullName, email, hashedPassword])
    res.status(200).json({ message: 'Usuario creado correctamente' })
  } catch (error) {
    console.error('❌ Error al crear usuario:', error)
    res.status(500).json({ error: 'Error del servidor' })
  }
})

app.post('/api/login', async (req, res) => {
  const { email, pass } = req.body

  try {
    const [rows] = await pool.execute(
      'SELECT id_user, fullName, email, pass, id_rol_id FROM users WHERE email = ?',
      [email],
    )

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' })
    }

    const user = rows[0]
    const match = await bcrypt.compare(pass, user.pass)

    if (!match) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' })
    }

    // 🔐 Crear el token
    const token = jwt.sign(
      {
        id_user: user.id_user,
        fullName: user.fullName,
        email: user.email,
        id_rol_id: user.id_rol_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
    )

    res.status(200).json({ token })
  } catch (error) {
    console.error('❌ Error en login:', error)
    res.status(500).json({ error: 'Error del servidor' })
  }
})

// app.post('/api/login', async (req, res) => {
//   const { email, pass } = req.body

//   try {
//     // 1. Buscar el usuario por correo
//     const [rows] = await pool.execute(
//       'SELECT id_user, fullName, email, pass FROM users WHERE email = ?',
//       [email],
//     )

//     if (rows.length === 0) {
//       return res.status(401).json({ error: 'Correo o contraseña incorrectos' })
//     }

//     const user = rows[0]

//     // 2. Comparar la contraseña ingresada con la almacenada (hasheada)
//     const match = await bcrypt.compare(pass, user.pass)

//     if (!match) {
//       return res.status(401).json({ error: 'Correo o contraseña incorrectos' })
//     }

//     // 3. Login exitoso
//     res.status(200).json({
//       message: 'Inicio de sesión exitoso',
//       user: {
//         id_user: user.id_user,
//         fullName: user.fullName,
//         email: user.email,
//         // Aquí podrías devolver un token si usaras JWT
//       },
//     })
//   } catch (error) {
//     console.error('❌ Error en login:', error)
//     res.status(500).json({ error: 'Error del servidor' })
//   }
// })

// Obtener todos los usuarios (requiere autenticación)
app.get('/api/leads', async (req, res) => {
  const page = parseInt(req.query.page) || 1 // Página actual, por defecto 1
  const limit = parseInt(req.query.limit) || 10 // Límites por página, por defecto 10
  const offset = (page - 1) * limit

  try {
    const [leads] = await pool.query(
      `
      SELECT * FROM contactos
      ORDER BY create_at DESC
      LIMIT ? OFFSET ?
    `,
      [limit, offset],
    )

    // Obtener total de registros
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM contactos`)

    res.json({
      data: leads,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('❌ Error al obtener leads:', error)
    res.status(500).json({ mensaje: 'Error al obtener leads' })
  }
})

// app.get('/api/leads', async (req, res) => {
//   try {
//     const [leads] = await pool.query(`
//       select * from contactos order by create_at desc
//     `)
//     res.json(leads)
//   } catch (error) {
//     console.error('Error al obtener leads:', error)
//     res.status(500).json({ mensaje: 'Error al obtener leads' })
//   }
// })

// Obtener un lead por ID
app.get('/api/leads/:id', async (req, res) => {
  const { id } = req.params

  try {
    const [lead] = await pool.query('SELECT * FROM contactos WHERE id = ?', [id])

    if (lead.length === 0) {
      return res.status(404).json({ mensaje: 'Lead no encontrado' })
    }

    res.json(lead[0])
  } catch (error) {
    console.error('Error al obtener lead:', error)
    res.status(500).json({ mensaje: 'Error del servidor' })
  }
})

app.put('/api/leads/:id/state', async (req, res) => {
  const { id } = req.params
  const { id_state_id } = req.body

  if (!id_state_id) {
    return res.status(400).json({ mensaje: 'El campo id_state_id es obligatorio.' })
  }

  try {
    const [result] = await pool.query('UPDATE contactos SET id_state_id = ? WHERE id = ?', [
      id_state_id,
      id,
    ])

    if (result.affectedRows === 0) {
      return res.status(404).json({ mensaje: 'Lead no encontrado.' })
    }

    res.json({ mensaje: 'Estado actualizado correctamente.' })
  } catch (error) {
    console.error('Error al actualizar el estado:', error)
    res.status(500).json({ mensaje: 'Error interno del servidor.' })
  }
})

app.get('/api/states', async (req, res) => {
  try {
    const [leads] = await pool.query(`
      select * from states
    `)
    res.json(leads)
  } catch (error) {
    console.error('Error al obtener leads:', error)
    res.status(500).json({ mensaje: 'Error al obtener leads' })
  }
})

app.listen(port, () => {
  console.log(`✅ API escuchando en http://localhost:${port}`)
})
