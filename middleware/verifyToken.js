function verifyTokenAndAdmin(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader) return res.status(401).json({ error: 'Token requerido' })

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    if (decoded.rol_id !== 2) {
      return res.status(403).json({ error: 'Acceso denegado: Rol no autorizado' })
    }

    req.user = decoded // Guardamos el usuario decodificado
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}
