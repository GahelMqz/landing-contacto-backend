const sql = require('mssql')

const config = {
  user: 'GAELPC\ThePo',
  password: '',
  server: 'localhost\\SQLEXPRESS',
  database: 'AcuarioDB',
  options: {
    trustServerCertificate: true,
    encrypt: false,
  },
}

sql
  .connect(config)
  .then(() => console.log('✅ Conexión exitosa a SQL Server'))
  .catch((err) => console.error('❌ Error al conectar:', err))
