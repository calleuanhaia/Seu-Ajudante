// 1. IMPORTANDO AS BIBLIOTECAS
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const dns = require('dns').promises;
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// 2. INICIALIZANDO O SERVIDOR EXPRESS
const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 3. CONECTANDO AO BANCO DE DADOS
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',             // Modifique se o seu usuário MySQL for diferente
  password: 'ca140806',             // Modifique se o seu MySQL tiver senha
  database: 'projetoservicos' // Atualizado para o novo banco
});

db.connect((err) => {
  if (err) throw err;
  console.log('Conectado ao banco de dados projetoservicos com sucesso!');
});

const SECRET_KEY = 'minha_chave_secreta_super_segura_123';

// ==========================================
// HELPERS DE VALIDAÇÃO E ENVIO DE CÓDIGO (6 DÍGITOS)
// ==========================================
function normalizarTelefone(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) {
    d = d.slice(2);
  }
  return d;
}

function validarTelefoneReal(tel) {
  const d = normalizarTelefone(tel);
  if (d.length !== 10 && d.length !== 11) {
    return { valido: false, erro: 'Telefone deve ter DDD + 8 ou 9 dígitos (ex: 11999998888).' };
  }
  const ddd = parseInt(d.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99 || ddd % 10 === 0) {
    return { valido: false, erro: 'DDD inválido.' };
  }
  if (/^(\d)\1+$/.test(d.slice(2))) {
    return { valido: false, erro: 'Número de telefone inválido.' };
  }
  if (d.length === 11 && d[2] !== '9') {
    return { valido: false, erro: 'Celular com 11 dígitos deve começar com 9 após o DDD.' };
  }
  return { valido: true, limpo: d };
}

async function validarEmailReal(email) {
  const valor = String(email || '').trim().toLowerCase();
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!regex.test(valor)) {
    return { valido: false, erro: 'Formato de e-mail inválido.' };
  }
  const dominio = valor.split('@')[1];
  try {
    const mx = await dns.resolveMx(dominio);
    if (!mx || mx.length === 0) {
      return { valido: false, erro: 'O domínio deste e-mail não possui servidor de correio (MX) válido.' };
    }
    return { valido: true, email: valor };
  } catch (e) {
    return { valido: false, erro: 'Domínio de e-mail inexistente ou inacessível.' };
  }
}

async function enviarEmailCodigo(email, codigo) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log(`[MODO TESTE - E-MAIL] Código para ${email}: ${codigo}`);
    return { enviadoReal: false };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  await transporter.sendMail({
    from: `"Projeto Serviços" <${SMTP_USER}>`,
    to: email,
    subject: 'Código de Verificação - Projeto Serviços',
    text: `Seu código de confirmação é: ${codigo}. Ele expira em 10 minutos.`,
    html: `<div style="font-family:sans-serif;padding:16px;"><h2>Projeto Serviços</h2><p>Seu código de verificação é:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#ca8a04;">${codigo}</p><p>Válido por 10 minutos.</p></div>`
  });
  return { enviadoReal: true };
}

async function enviarSmsCodigo(telefoneLimpo, codigo) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log(`[MODO TESTE - SMS] Código para +55${telefoneLimpo}: ${codigo}`);
    return { enviadoReal: false };
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({
    To: `+55${telefoneLimpo}`,
    From: TWILIO_PHONE_NUMBER,
    Body: `Projeto Servicos: seu codigo de confirmacao e ${codigo}. Valido por 10 minutos.`
  });

  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Falha ao enviar SMS: ${errText}`);
  }
  return { enviadoReal: true };
}

// ==========================================
// ROTA: ENVIAR CÓDIGO DE 6 DÍGITOS (E-MAIL OU TELEFONE)
// ==========================================
app.post('/enviar-codigo', async (req, res) => {
  const { tipo, destino } = req.body;
  if (tipo !== 'email' && tipo !== 'telefone') {
    return res.status(400).json({ erro: 'Tipo deve ser "email" ou "telefone".' });
  }

  let destinoNormalizado = '';
  if (tipo === 'email') {
    const valEmail = await validarEmailReal(destino);
    if (!valEmail.valido) return res.status(400).json({ erro: valEmail.erro });
    destinoNormalizado = valEmail.email;
  } else {
    const valTel = validarTelefoneReal(destino);
    if (!valTel.valido) return res.status(400).json({ erro: valTel.erro });
    destinoNormalizado = valTel.limpo;
  }

  const codigo = crypto.randomInt(100000, 1000000).toString();

  db.query('DELETE FROM verificacoes_cadastro WHERE destino = ? AND tipo = ?', [destinoNormalizado, tipo], async (errDel) => {
    if (errDel) return res.status(500).json({ erro: 'Erro ao preparar verificação.' });

    const sqlIns = `
      INSERT INTO verificacoes_cadastro (destino, tipo, codigo, verificado, tentativas, expira_em)
      VALUES (?, ?, ?, 0, 0, DATE_ADD(NOW(), INTERVAL 10 MINUTE))
    `;
    db.query(sqlIns, [destinoNormalizado, tipo, codigo], (errIns) => {
      if (errIns) return res.status(500).json({ erro: 'Erro ao gerar código de verificação.' });

      // Envio externo desacoplado do Node.js:
      // O código é gerado e armazenado aqui; o envio real (SMS / e-mail) ocorre fora do Node.js.
      console.log(`[CÓDIGO GERADO] ${tipo.toUpperCase()} -> ${destinoNormalizado}: ${codigo}`);
      res.json({
        codigo,
        mensagem: `Código gerado para ${tipo === 'email' ? 'e-mail' : 'SMS'}. Informe o código recebido no campo abaixo.`
      });
    });
  });
});

// ==========================================
// ROTA: VERIFICAR CÓDIGO DE 6 DÍGITOS
// ==========================================
app.post('/verificar-codigo', async (req, res) => {
  const { tipo, destino, codigo } = req.body;
  if ((tipo !== 'email' && tipo !== 'telefone') || !destino || !codigo) {
    return res.status(400).json({ erro: 'Informe tipo, destino e o código de 6 dígitos.' });
  }

  const destinoNormalizado = tipo === 'email'
    ? String(destino).trim().toLowerCase()
    : normalizarTelefone(destino);

  const sql = `
    SELECT * FROM verificacoes_cadastro
    WHERE destino = ? AND tipo = ?
    ORDER BY id DESC LIMIT 1
  `;
  db.query(sql, [destinoNormalizado, tipo], (err, rows) => {
    if (err) return res.status(500).json({ erro: 'Erro ao validar código.' });
    if (rows.length === 0) {
      return res.status(400).json({ erro: 'Nenhum código foi solicitado para este contato.' });
    }

    const reg = rows[0];
    if (new Date(reg.expira_em) < new Date()) {
      return res.status(400).json({ erro: 'Código expirado. Solicite um novo código.' });
    }
    if (reg.tentativas >= 5) {
      return res.status(429).json({ erro: 'Muitas tentativas inválidas. Solicite um novo código.' });
    }

    if (String(codigo).trim() !== String(reg.codigo)) {
      db.query('UPDATE verificacoes_cadastro SET tentativas = tentativas + 1 WHERE id = ?', [reg.id]);
      return res.status(400).json({ erro: 'Código incorreto.' });
    }

    db.query('UPDATE verificacoes_cadastro SET verificado = 1 WHERE id = ?', [reg.id], (errUpd) => {
      if (errUpd) return res.status(500).json({ erro: 'Erro ao confirmar verificação.' });
      res.json({ mensagem: `${tipo === 'email' ? 'E-mail' : 'Telefone'} confirmado com sucesso!`, verificado: true });
    });
  });
});

// ==========================================
// ROTA 1: REGISTRO DE USUÁRIO (Cliente ou Trabalhador)
// ==========================================
app.post('/registrar', async (req, res) => {
  // Recebe os novos campos e o "tipo" ('cliente' ou 'trabalhador')
  const { usuario, email, telefone, senha, cpf, tipo, endereco, cidade, estado, cep, latitude, longitude, horarios } = req.body;

  // Validação simples do tipo
  if (!tipo || (tipo !== 'cliente' && tipo !== 'trabalhador')) {
    return res.status(400).json({ erro: 'Informe um tipo válido: "cliente" ou "trabalhador".' });
  }

  // Validação de e-mail e telefone reais
  const valEmail = await validarEmailReal(email);
  if (!valEmail.valido) {
    return res.status(400).json({ erro: valEmail.erro });
  }
  const valTel = validarTelefoneReal(telefone);
  if (!valTel.valido) {
    return res.status(400).json({ erro: valTel.erro });
  }
  const emailNormalizado = valEmail.email;
  const telefoneNormalizado = valTel.limpo;

  // Verifica se ambos possuem código confirmado
  const sqlVerif = `
    SELECT tipo FROM verificacoes_cadastro
    WHERE ((destino = ? AND tipo = 'email') OR (destino = ? AND tipo = 'telefone'))
      AND verificado = 1
      AND expira_em >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
  `;
  const verifRows = await new Promise((resolve, reject) => {
    db.query(sqlVerif, [emailNormalizado, telefoneNormalizado], (errV, rowsV) => {
      if (errV) reject(errV);
      else resolve(rowsV);
    });
  }).catch(() => null);

  if (!verifRows) {
    return res.status(500).json({ erro: 'Erro ao verificar confirmações de contato.' });
  }
  const tiposConfirmados = new Set(verifRows.map(r => r.tipo));
  if (!tiposConfirmados.has('email') || !tiposConfirmados.has('telefone')) {
    return res.status(400).json({ erro: 'Confirme o código de 6 dígitos no e-mail e no telefone antes de finalizar o cadastro.' });
  }

  // Se for trabalhador, valida horários obrigatórios (ao menos 1 dia e 1 período)
  if (tipo === 'trabalhador') {
    if (!Array.isArray(horarios) || horarios.length === 0) {
      return res.status(400).json({ erro: 'Trabalhadores devem informar ao menos um dia e período de trabalho.' });
    }
    for (const h of horarios) {
      if (h.dia_semana === undefined || !h.periodo || !h.hora_inicio || !h.hora_fim) {
        return res.status(400).json({ erro: 'Cada horário deve conter dia da semana, período, início e fim.' });
      }
      if (h.hora_inicio >= h.hora_fim) {
        return res.status(400).json({ erro: 'O horário de início deve ser anterior ao horário de fim.' });
      }
    }
  }

  // Define a tabela de destino
  const tabela = tipo === 'cliente' ? 'clientes' : 'trabalhadores';

  try {
    // Gerando o Hash da senha
    const salt = await bcrypt.genSalt(10);
    const senhaCriptografada = await bcrypt.hash(senha, salt);

    // SQL com campos de localização
    const sql = `INSERT INTO ${tabela} (usuario, email, telefone, senha, cpf, endereco, cidade, estado, cep, latitude, longitude)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(sql, [
      usuario, emailNormalizado, telefoneNormalizado, senhaCriptografada, cpf,
      endereco || null, cidade || null, estado || null, cep || null,
      latitude || null, longitude || null
    ], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ erro: 'Usuário, e-mail, telefone ou CPF já cadastrado.' });
        }
        return res.status(500).json({ erro: 'Erro interno no banco de dados.' });
      }

      // Remove códigos já utilizados
      db.query(
        "DELETE FROM verificacoes_cadastro WHERE (destino = ? AND tipo = 'email') OR (destino = ? AND tipo = 'telefone')",
        [emailNormalizado, telefoneNormalizado]
      );

      if (tipo === 'trabalhador' && Array.isArray(horarios) && horarios.length > 0) {
        const idTrabalhador = result.insertId;
        const valores = horarios.map(h => [idTrabalhador, h.dia_semana, h.periodo, h.hora_inicio, h.hora_fim]);
        db.query(
          'INSERT INTO horarios_trabalhador (id_trabalhador, dia_semana, periodo, hora_inicio, hora_fim) VALUES ?',
          [valores],
          (errHor) => {
            if (errHor) {
              console.error('Erro ao salvar horários no registro:', errHor);
              return res.status(500).json({ erro: 'Conta criada, mas erro ao salvar horários.' });
            }
            res.status(201).json({ mensagem: 'Trabalhador registrado com sucesso!' });
          }
        );
      } else {
        res.status(201).json({ mensagem: `${tipo === 'cliente' ? 'Cliente' : 'Trabalhador'} registrado com sucesso!` });
      }
    });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao processar a segurança da senha.' });
  }
});

// ==========================================
// ROTA 2: LOGIN E GERAÇÃO DE TOKEN
// ==========================================
app.post('/login', (req, res) => {
  // É possível fazer login usando o usuário ou email
  const { usuario, senha, tipo } = req.body;

  if (!tipo || (tipo !== 'cliente' && tipo !== 'trabalhador')) {
    return res.status(400).json({ erro: 'Informe o tipo de usuário: "cliente" ou "trabalhador".' });
  }

  const tabela = tipo === 'cliente' ? 'clientes' : 'trabalhadores';

  // Busca por nome de usuário OU e-mail
  const sql = `SELECT * FROM ${tabela} WHERE usuario = ? OR email = ?`;

  db.query(sql, [usuario, usuario], async (err, results) => {
    if (err) return res.status(500).json({ erro: 'Erro no servidor.' });

    if (results.length === 0) {
      return res.status(401).json({ erro: 'Usuário/E-mail não encontrado.' });
    }

    const usuarioDoBanco = results[0];

    // Comparando a senha com o Hash
    const senhaEhValida = await bcrypt.compare(senha, usuarioDoBanco.senha);

    if (!senhaEhValida) {
      return res.status(401).json({ erro: 'Senha incorreta.' });
    }

    // Gerando o Token JWT com ID, Usuário e Tipo
    const token = jwt.sign(
      { id: usuarioDoBanco.id, usuario: usuarioDoBanco.usuario, tipo: tipo },
      SECRET_KEY,
      { expiresIn: '1h' }
    );

    res.json({
      mensagem: 'Login realizado com sucesso',
      token: token,
      tipo: tipo
    });
  });
});

function autenticarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ erro: 'Acesso negado. Token não fornecido.' });
  }

  jwt.verify(token, SECRET_KEY, (err, usuario) => {
    if (err) return res.status(403).json({ erro: 'Token inválido ou expirado.' });
    req.usuario = usuario;
    next();
  });
}

// ==========================================
// ROTA 3: CADASTRO DE SERVIÇO OFERECIDO (Trabalhador)
// ==========================================
app.post('/servicos-oferecidos', autenticarToken, (req, res) => {
  if (req.usuario.tipo !== 'trabalhador') {
    return res.status(403).json({ erro: 'Apenas trabalhadores podem oferecer serviços.' });
  }

  const { titulo, descricao, preco } = req.body;
  const id_trabalhador = req.usuario.id;

  if (!titulo || !preco) {
    return res.status(400).json({ erro: 'Título e Preço são obrigatórios.' });
  }

  const sql = `INSERT INTO servicos_oferecidos (id_trabalhador, titulo, descricao, preco) VALUES (?, ?, ?, ?)`;

  db.query(sql, [id_trabalhador, titulo, descricao, preco], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ erro: 'Erro ao cadastrar serviço no banco de dados.' });
    }

    res.status(201).json({
      mensagem: 'Serviço cadastrado com sucesso!',
      id_servico: result.insertId
    });
  });
});

// Auxiliar: distância em km entre duas coordenadas (fórmula de Haversine)
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ==========================================
// ROTA: LOCALIZAÇÃO DO USUÁRIO LOGADO
// ==========================================
app.get('/meu-perfil/localizacao', autenticarToken, (req, res) => {
  const tabela = req.usuario.tipo === 'cliente' ? 'clientes' : 'trabalhadores';
  const sql = `SELECT endereco, cidade, estado, cep, latitude, longitude FROM ${tabela} WHERE id = ?`;
  db.query(sql, [req.usuario.id], (err, results) => {
    if (err) return res.status(500).json({ erro: 'Erro ao buscar localização.' });
    if (results.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    res.json(results[0]);
  });
});

// ==========================================
// ROTA 4: LISTAR SERVIÇOS COM PROXIMIDADE E FILTROS
// ==========================================
app.get('/servicos-oferecidos', autenticarToken, (req, res) => {
  const { busca, cidade, estado, preco_max, nota_min, raio_km, ordenar, lat, lon } = req.query;

  const executarConsulta = (refLoc) => {
    const condicoes = [];
    const params = [];

    if (busca && busca.trim()) {
      const termo = `%${busca.trim().toLowerCase()}%`;
      condicoes.push('(LOWER(so.titulo) LIKE ? OR LOWER(so.descricao) LIKE ? OR LOWER(t.usuario) LIKE ?)');
      params.push(termo, termo, termo);
    }

    if (cidade && cidade.trim()) {
      condicoes.push('LOWER(t.cidade) LIKE ?');
      params.push(`%${cidade.trim().toLowerCase()}%`);
    }

    if (estado && estado.trim()) {
      condicoes.push('UPPER(t.estado) = ?');
      params.push(estado.trim().toUpperCase());
    }

    if (preco_max !== undefined && preco_max !== '' && !isNaN(Number(preco_max))) {
      condicoes.push('so.preco <= ?');
      params.push(Number(preco_max));
    }

    const whereClause = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const sql = `
      SELECT 
        so.id, 
        so.id_trabalhador, 
        so.titulo, 
        so.descricao, 
        so.preco, 
        so.data_criacao,
        t.usuario AS nome_trabalhador,
        t.email AS email_trabalhador,
        t.telefone AS telefone_trabalhador,
        t.cidade AS cidade_trabalhador,
        t.estado AS estado_trabalhador,
        t.latitude AS lat_trabalhador,
        t.longitude AS lon_trabalhador,
        AVG(a.nota) AS media_nota
      FROM servicos_oferecidos so
      INNER JOIN trabalhadores t ON so.id_trabalhador = t.id
      LEFT JOIN avaliacoes_servicos a ON a.id_servico = so.id
      ${whereClause}
      GROUP BY so.id
      ORDER BY so.id DESC
    `;

    db.query(sql, params, (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ erro: 'Erro ao carregar o feed de serviços.' });
      }

      const refLat = refLoc && refLoc.latitude != null ? parseFloat(refLoc.latitude) : null;
      const refLon = refLoc && refLoc.longitude != null ? parseFloat(refLoc.longitude) : null;
      const refCidade = refLoc && refLoc.cidade ? refLoc.cidade.trim().toLowerCase() : null;
      const refEstado = refLoc && refLoc.estado ? refLoc.estado.trim().toUpperCase() : null;

      let lista = results.map((s) => {
        let distancia_km = null;
        if (refLat !== null && refLon !== null && s.lat_trabalhador != null && s.lon_trabalhador != null) {
          distancia_km = Number(calcularDistanciaKm(
            refLat,
            refLon,
            parseFloat(s.lat_trabalhador),
            parseFloat(s.lon_trabalhador)
          ).toFixed(1));
        }

        const mesma_cidade = Boolean(
          refCidade && s.cidade_trabalhador &&
          s.cidade_trabalhador.trim().toLowerCase() === refCidade
        );
        const mesmo_estado = Boolean(
          refEstado && s.estado_trabalhador &&
          s.estado_trabalhador.trim().toUpperCase() === refEstado
        );

        return {
          ...s,
          distancia_km,
          mesma_cidade,
          mesmo_estado
        };
      });

      if (nota_min !== undefined && nota_min !== '' && !isNaN(Number(nota_min))) {
        const minNota = Number(nota_min);
        lista = lista.filter((s) => {
          const nota = s.media_nota !== null ? parseFloat(s.media_nota) : 5;
          return nota >= minNota;
        });
      }

      if (raio_km !== undefined && raio_km !== '' && !isNaN(Number(raio_km))) {
        const raio = Number(raio_km);
        lista = lista.filter((s) => s.distancia_km !== null && s.distancia_km <= raio);
      }

      if (ordenar === 'proximidade') {
        lista.sort((a, b) => {
          const dA = a.distancia_km !== null ? a.distancia_km : (a.mesma_cidade ? 10000 : a.mesmo_estado ? 20000 : 99999);
          const dB = b.distancia_km !== null ? b.distancia_km : (b.mesma_cidade ? 10000 : b.mesmo_estado ? 20000 : 99999);
          if (dA !== dB) return dA - dB;
          return b.id - a.id;
        });
      } else if (ordenar === 'menor_preco') {
        lista.sort((a, b) => parseFloat(a.preco) - parseFloat(b.preco));
      } else if (ordenar === 'maior_preco') {
        lista.sort((a, b) => parseFloat(b.preco) - parseFloat(a.preco));
      } else if (ordenar === 'melhor_avaliacao') {
        lista.sort((a, b) => {
          const nA = a.media_nota !== null ? parseFloat(a.media_nota) : 5;
          const nB = b.media_nota !== null ? parseFloat(b.media_nota) : 5;
          return nB - nA;
        });
      }

      res.json(lista);
    });
  };

  // Se lat/lon vieram na query, usa eles direto; senão busca a localização salva do cliente
  if (lat !== undefined && lon !== undefined && lat !== '' && lon !== '' && !isNaN(Number(lat)) && !isNaN(Number(lon))) {
    return executarConsulta({ latitude: Number(lat), longitude: Number(lon) });
  }

  if (req.usuario.tipo === 'cliente') {
    db.query('SELECT cidade, estado, latitude, longitude FROM clientes WHERE id = ?', [req.usuario.id], (err, rows) => {
      if (err || rows.length === 0) return executarConsulta(null);
      return executarConsulta(rows[0]);
    });
  } else {
    executarConsulta(null);
  }
});

// ==========================================
// ROTA 5: OBTER DETALHES DO SERVIÇO E COMENTÁRIOS
// ==========================================
app.get('/servicos-oferecidos/:id', autenticarToken, (req, res) => {
  const idServico = req.params.id;
  const idUsuario = req.usuario.id;

  const sqlServico = `
    SELECT 
      so.id, 
      so.id_trabalhador, 
      so.titulo, 
      so.descricao, 
      so.preco,
      t.usuario AS nome_trabalhador,
      t.telefone AS telefone_trabalhador
    FROM servicos_oferecidos so
    INNER JOIN trabalhadores t ON so.id_trabalhador = t.id
    WHERE so.id = ?
  `;

  const sqlComentarios = `
    SELECT 
      a.id_cliente, a.nota, a.comentario, a.data_avaliacao,
      c.usuario AS nome_cliente
    FROM avaliacoes_servicos a
    INNER JOIN clientes c ON a.id_cliente = c.id
    WHERE a.id_servico = ?
    ORDER BY a.id DESC
  `;

  db.query(sqlServico, [idServico], (err, resultsServico) => {
    if (err || resultsServico.length === 0) {
      return res.status(404).json({ erro: 'Serviço não encontrado.' });
    }

    db.query(sqlComentarios, [idServico], (errCom, resultsComentarios) => {
      if (errCom) {
        return res.status(500).json({ erro: 'Erro ao buscar comentários.' });
      }

      const jaAvaliou = req.usuario.tipo === 'cliente' &&
        resultsComentarios.some(c => c.id_cliente === idUsuario);

      res.json({
        ...resultsServico[0],
        comentarios: resultsComentarios,
        jaAvaliou: jaAvaliou
      });
    });
  });
});

// ==========================================
// ROTA 6: ADICIONAR AVALIAÇÃO (TRAVA DE UMA AVALIAÇÃO POR CLIENTE)
// ==========================================
app.post('/servicos-oferecidos/:id/avaliar', autenticarToken, (req, res) => {
  if (req.usuario.tipo !== 'cliente') {
    return res.status(403).json({ erro: 'Apenas clientes podem avaliar serviços.' });
  }

  const idServico = req.params.id;
  const idCliente = req.usuario.id;
  const { nota, comentario } = req.body;

  if (!nota || nota < 1 || nota > 5) {
    return res.status(400).json({ erro: 'Forneça uma nota válida de 1 a 5.' });
  }

  // Trava no backend: verifica se o cliente já avaliou esse serviço anteriormente
  const sqlCheck = `SELECT id FROM avaliacoes_servicos WHERE id_servico = ? AND id_cliente = ?`;

  db.query(sqlCheck, [idServico, idCliente], (errCheck, resultsCheck) => {
    if (errCheck) {
      return res.status(500).json({ erro: 'Erro ao validar avaliação.' });
    }

    if (resultsCheck.length > 0) {
      return res.status(400).json({ erro: 'Você já enviou uma avaliação para este serviço.' });
    }

    const sqlInsert = `INSERT INTO avaliacoes_servicos (id_servico, id_cliente, nota, comentario) VALUES (?, ?, ?, ?)`;

    db.query(sqlInsert, [idServico, idCliente, nota, comentario || ''], (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ erro: 'Erro ao salvar avaliação.' });
      }

      // Notifica o trabalhador sobre a nova avaliação
      db.query('SELECT id_trabalhador, titulo FROM servicos_oferecidos WHERE id = ?', [idServico], (errS, rowsS) => {
        if (!errS && rowsS.length > 0) {
          criarNotificacao(
            rowsS[0].id_trabalhador,
            'trabalhador',
            'Nova Avaliação Recebida',
            `Um cliente avaliou "${rowsS[0].titulo}" com ${nota} estrela(s).`
          );
        }
      });

      res.status(201).json({ mensagem: 'Avaliação enviada com sucesso!' });
    });
  });
});

// ==========================================
// HELPER E ROTAS: NOTIFICAÇÕES (AMBOS OS PERFIS)
// ==========================================
function criarNotificacao(id_usuario, tipo_usuario, titulo, mensagem) {
  if (!id_usuario || !tipo_usuario) return;
  const sql = 'INSERT INTO notificacoes (id_usuario, tipo_usuario, titulo, mensagem, lida) VALUES (?, ?, ?, ?, 0)';
  db.query(sql, [id_usuario, tipo_usuario, titulo, mensagem], (err) => {
    if (err) console.error('Erro ao criar notificação:', err);
  });
}

app.get('/notificacoes', autenticarToken, (req, res) => {
  const sql = `
    SELECT id, titulo, mensagem, lida, DATE_FORMAT(data_criacao, '%d/%m %H:%i') as data_formatada 
    FROM notificacoes 
    WHERE id_usuario = ? AND tipo_usuario = ? 
    ORDER BY id DESC LIMIT 20
  `;

  db.query(sql, [req.usuario.id, req.usuario.tipo], (err, results) => {
    if (err) {
      return res.json([]);
    }
    res.json(results);
  });
});

// Marcar todas como lidas
app.put('/notificacoes/ler-todas', autenticarToken, (req, res) => {
  const sql = 'UPDATE notificacoes SET lida = 1 WHERE id_usuario = ? AND tipo_usuario = ?';
  db.query(sql, [req.usuario.id, req.usuario.tipo], (err) => {
    if (err) return res.status(500).json({ erro: 'Erro ao atualizar notificações.' });
    res.json({ mensagem: 'Todas as notificações foram marcadas como lidas.' });
  });
});

// Marcar uma notificação como lida
app.put('/notificacoes/:id/lida', autenticarToken, (req, res) => {
  const sql = 'UPDATE notificacoes SET lida = 1 WHERE id = ? AND id_usuario = ? AND tipo_usuario = ?';
  db.query(sql, [req.params.id, req.usuario.id, req.usuario.tipo], (err) => {
    if (err) return res.status(500).json({ erro: 'Erro ao atualizar notificação.' });
    res.json({ mensagem: 'Notificação marcada como lida.' });
  });
});

// Limpar notificações já lidas
app.delete('/notificacoes/limpar', autenticarToken, (req, res) => {
  const sql = 'DELETE FROM notificacoes WHERE id_usuario = ? AND tipo_usuario = ? AND lida = 1';
  db.query(sql, [req.usuario.id, req.usuario.tipo], (err) => {
    if (err) return res.status(500).json({ erro: 'Erro ao limpar notificações.' });
    res.json({ mensagem: 'Notificações lidas removidas.' });
  });
});

// ==========================================
// ROTA: RECENTES DO TRABALHADOR
// ==========================================
app.get('/trabalhador/recentes', autenticarToken, (req, res) => {
  if (req.usuario.tipo !== 'trabalhador') {
    return res.status(403).json({ erro: 'Acesso negado.' });
  }

  const idTrabalhador = req.usuario.id;

  const sql = `
    SELECT 
      so.id, 
      so.titulo, 
      so.preco,
      'ativo' as status,
      'Sem solicitações' as nome_cliente
    FROM servicos_oferecidos so
    WHERE so.id_trabalhador = ?
    ORDER BY so.id DESC LIMIT 5
  `;

  db.query(sql, [idTrabalhador], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ erro: 'Erro ao buscar dados recentes.' });
    }
    res.json(results);
  });
});

// ==========================================
// ROTA: ATUALIZAR SERVIÇO OFERECIDO
// ==========================================
app.put('/servicos-oferecidos/:id', autenticarToken, (req, res) => {
  if (req.usuario.tipo !== 'trabalhador') {
    return res.status(403).json({ erro: 'Acesso negado.' });
  }

  const { id } = req.params;
  const { titulo, descricao, preco } = req.body;
  const idTrabalhador = req.usuario.id;

  if (!titulo || !preco) {
    return res.status(400).json({ erro: 'Título e Preço são obrigatórios.' });
  }

  const sql = 'UPDATE servicos_oferecidos SET titulo = ?, descricao = ?, preco = ? WHERE id = ? AND id_trabalhador = ?';
  db.query(sql, [titulo, descricao, preco, id, idTrabalhador], (err, result) => {
    if (err) return res.status(500).json({ erro: 'Erro ao atualizar no banco de dados.' });
    if (result.affectedRows === 0) return res.status(404).json({ erro: 'Serviço não encontrado ou acesso negado.' });

    res.json({ mensagem: 'Serviço atualizado com sucesso!' });
  });
});

// ==========================================
// ROTA: LISTAR SERVIÇOS CONTRATADOS (CLIENTE E TRABALHADOR)
// ==========================================
const buscarServicosContratados = (req, res) => {
  const idUsuario = req.usuario.id;
  const tipoUsuario = req.usuario.tipo;
  const colunaFiltro = tipoUsuario === 'cliente' ? 's.id_cliente' : 's.id_trabalhador';

  const sql = `
    SELECT 
      s.id,
      s.descricao AS titulo,
      s.descricao,
      s.valor,
      s.valor AS preco,
      s.data_pedido,
      s.data_finalizado,
      s.status,
      s.motivo_cancelamento,
      s.cancelado_por,
      c.usuario AS nome_cliente,
      t.usuario AS nome_trabalhador,
      (SELECT ag.data_agendamento FROM agendamentos ag WHERE ag.id_servico = s.id AND ag.status_agendamento != 'cancelado' ORDER BY ag.id DESC LIMIT 1) AS data_agendamento,
      (SELECT ag.hora_agendamento FROM agendamentos ag WHERE ag.id_servico = s.id AND ag.status_agendamento != 'cancelado' ORDER BY ag.id DESC LIMIT 1) AS hora_agendamento,
      (SELECT ag.status_agendamento FROM agendamentos ag WHERE ag.id_servico = s.id AND ag.status_agendamento != 'cancelado' ORDER BY ag.id DESC LIMIT 1) AS status_agendamento
    FROM servicos s
    INNER JOIN clientes c ON s.id_cliente = c.id
    INNER JOIN trabalhadores t ON s.id_trabalhador = t.id
    WHERE ${colunaFiltro} = ?
    ORDER BY s.id DESC
  `;

  db.query(sql, [idUsuario], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ erro: 'Erro ao buscar histórico de serviços contratados.' });
    }
    res.json(results);
  });
};

// Aliases para garantir compatibilidade com qualquer requisição do front-end
app.get('/servicos/contratados', autenticarToken, buscarServicosContratados);
app.get('/meus-pedidos', autenticarToken, buscarServicosContratados);
app.get('/meus-servicos-contratados', autenticarToken, buscarServicosContratados);

// ==========================================
// ROTA: ATUALIZAR STATUS DO SERVIÇO (CONCLUÍDO / CANCELADO)
// ==========================================
app.put('/servicos/:id/status', autenticarToken, (req, res) => {
  const { id } = req.params;
  const { status, motivo_cancelamento } = req.body;
  const tipoUsuario = req.usuario.tipo;
  const idUsuario = req.usuario.id;
  const colunaFiltro = tipoUsuario === 'cliente' ? 'id_cliente' : 'id_trabalhador';

  if (!status) {
    return res.status(400).json({ erro: 'O novo status é obrigatório.' });
  }

  const statusUpper = String(status).toUpperCase();
  const ehConcluido = statusUpper.includes('CONCLU');
  const ehCancelado = statusUpper.includes('CANCEL');

  // Validação obrigatória do motivo em caso de cancelamento
  if (ehCancelado && (!motivo_cancelamento || !motivo_cancelamento.trim())) {
    return res.status(400).json({ erro: 'Por favor, informe o motivo do cancelamento.' });
  }

  // Define data_finalizado como NOW() para CONCLUÍDO e CANCELADO, ou NULL para outros status
  const sql = `
    UPDATE servicos 
    SET status = ?, 
        data_finalizado = ${(ehConcluido || ehCancelado) ? 'NOW()' : 'NULL'},
        motivo_cancelamento = ?,
        cancelado_por = ?
    WHERE id = ? AND ${colunaFiltro} = ?
  `;

  const motivo = ehCancelado ? motivo_cancelamento.trim() : null;
  const cancelador = ehCancelado ? tipoUsuario : null;

  db.query(sql, [status, motivo, cancelador, id, idUsuario], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ erro: 'Erro ao atualizar status no banco de dados.' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Serviço não encontrado ou sem permissão.' });
    }

    // Sincroniza o status dos agendamentos vinculados ao serviço
    if (ehCancelado) {
      db.query("UPDATE agendamentos SET status_agendamento = 'cancelado' WHERE id_servico = ?", [id]);
    } else if (statusUpper.includes('ANDAMENTO') || ehConcluido) {
      db.query("UPDATE agendamentos SET status_agendamento = 'confirmado' WHERE id_servico = ? AND status_agendamento = 'pendente'", [id]);
    }

    // Notifica a outra parte envolvida no serviço
    db.query('SELECT id_cliente, id_trabalhador FROM servicos WHERE id = ?', [id], (errS, rowsS) => {
      if (!errS && rowsS.length > 0) {
        const destTipo = tipoUsuario === 'cliente' ? 'trabalhador' : 'cliente';
        const destId = tipoUsuario === 'cliente' ? rowsS[0].id_trabalhador : rowsS[0].id_cliente;
        const msg = ehCancelado
          ? `O serviço #${id} foi cancelado. Motivo: ${motivo}`
          : `O status do serviço #${id} foi atualizado para "${status}".`;
        criarNotificacao(destId, destTipo, 'Atualização de Serviço', msg);
      }
    });

    res.json({
      mensagem: 'Status atualizado com sucesso!',
      status: status,
      data_finalizado: (ehConcluido || ehCancelado) ? new Date() : null,
      motivo_cancelamento: motivo,
      cancelado_por: cancelador
    });
  });
});

// ==========================================
// ROTA: CONTRATAÇÃO DIRETA (COMPATÍVEL COM O FORMULÁRIO DO MODAL)
// ==========================================
app.post('/servicos', autenticarToken, (req, res) => {
  if (req.usuario.tipo !== 'cliente') {
    return res.status(403).json({ erro: 'Apenas clientes podem contratar serviços.' });
  }

  const { id_trabalhador, descricao, valor, especificacoes, data_agendamento, hora_agendamento } = req.body;
  const id_cliente = req.usuario.id;

  if (!id_trabalhador || !valor) {
    return res.status(400).json({ erro: 'ID do profissional e valor são obrigatórios.' });
  }

  // Junta a descrição original com as especificações informadas pelo cliente
  const descricaoFinal = especificacoes
    ? `${descricao || ''}\n\n[Especificações do Cliente]: ${especificacoes}`
    : descricao;

  const sqlInsert = `
    INSERT INTO servicos (id_cliente, id_trabalhador, descricao, valor, data_pedido, status) 
    VALUES (?, ?, ?, ?, CURDATE(), 'AGUARDANDO APROVAÇÃO')
  `;

  db.query(sqlInsert, [id_cliente, id_trabalhador, descricaoFinal, valor], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ erro: 'Erro ao registrar contratação no banco de dados.' });
    }

    const idContratacao = result.insertId;

    // Se data e hora foram informadas, valida horário e cria agendamento vinculado
    if (data_agendamento && hora_agendamento) {
      validarHorarioTrabalhador(id_trabalhador, data_agendamento, hora_agendamento, (errVal, resultado) => {
        if (errVal) { console.error(errVal); return res.status(500).json({ erro: 'Erro ao validar horário.' }); }
        if (!resultado.valido) return res.status(400).json({ erro: resultado.erro });

        const sqlAgend = `
          INSERT INTO agendamentos (id_servico, id_cliente, id_trabalhador, data_agendamento, hora_agendamento, observacao, status_agendamento)
          VALUES (?, ?, ?, ?, ?, ?, 'pendente')
        `;
        db.query(sqlAgend, [idContratacao, id_cliente, id_trabalhador, data_agendamento, hora_agendamento, especificacoes || null], (errAgend) => {
          if (errAgend) console.error('Erro ao criar agendamento vinculado:', errAgend);
          const dataBr = data_agendamento.split('-').reverse().join('/');
          criarNotificacao(
            id_trabalhador,
            'trabalhador',
            'Novo Serviço Contratado',
            `Um cliente contratou seu serviço (R$ ${parseFloat(valor).toFixed(2)}) agendado para ${dataBr} às ${hora_agendamento}.`
          );
          return res.status(201).json({
            mensagem: 'Serviço contratado e agendado com sucesso!',
            id_contratacao: idContratacao
          });
        });
      });
    } else {
      criarNotificacao(
        id_trabalhador,
        'trabalhador',
        'Novo Serviço Contratado',
        `Um cliente solicitou seu serviço (R$ ${parseFloat(valor).toFixed(2)}).`
      );
      res.status(201).json({
        mensagem: 'Serviço contratado com sucesso!',
        id_contratacao: idContratacao
      });
    }
  });
});

// ==========================================
// ROTAS DE AGENDAMENTOS
// ==========================================

// Listar agendamentos do mês (cliente vê os seus pedidos, trabalhador vê os seus serviços)
app.get('/agendamentos', autenticarToken, (req, res) => {
  const { ano, mes } = req.query;
  const { id, tipo } = req.usuario;

  const coluna = tipo === 'cliente' ? 'ag.id_cliente' : 'ag.id_trabalhador';

  const sql = `
    SELECT ag.*,
      s.descricao, s.valor,
      CASE WHEN ag.id_cliente = ? THEN t.usuario ELSE c.usuario END AS nome_outro
    FROM agendamentos ag
    INNER JOIN servicos s ON ag.id_servico = s.id
    INNER JOIN clientes c ON ag.id_cliente = c.id
    INNER JOIN trabalhadores t ON ag.id_trabalhador = t.id
    WHERE ${coluna} = ?
      AND YEAR(ag.data_agendamento) = ?
      AND MONTH(ag.data_agendamento) = ?
    ORDER BY ag.data_agendamento, ag.hora_agendamento
  `;

  db.query(sql, [id, id, ano || new Date().getFullYear(), mes || new Date().getMonth() + 1], (err, results) => {
    if (err) { console.error(err); return res.status(500).json({ erro: 'Erro ao buscar agendamentos.' }); }
    res.json(results);
  });
});

// Próximos agendamentos (a partir de hoje)
app.get('/agendamentos/proximos', autenticarToken, (req, res) => {
  const { id, tipo } = req.usuario;
  const coluna = tipo === 'cliente' ? 'ag.id_cliente' : 'ag.id_trabalhador';

  const sql = `
    SELECT ag.*,
      s.descricao, s.valor,
      CASE WHEN ag.id_cliente = ? THEN t.usuario ELSE c.usuario END AS nome_outro
    FROM agendamentos ag
    INNER JOIN servicos s ON ag.id_servico = s.id
    INNER JOIN clientes c ON ag.id_cliente = c.id
    INNER JOIN trabalhadores t ON ag.id_trabalhador = t.id
    WHERE ${coluna} = ?
      AND ag.status_agendamento != 'cancelado'
      AND CONCAT(ag.data_agendamento, ' ', COALESCE(ag.hora_agendamento, '23:59')) >= NOW()
    ORDER BY ag.data_agendamento, ag.hora_agendamento
    LIMIT 10
  `;

  db.query(sql, [id, id], (err, results) => {
    if (err) { console.error(err); return res.status(500).json({ erro: 'Erro ao buscar próximos agendamentos.' }); }
    res.json(results);
  });
});

// Helper: valida hora do agendamento contra os horários cadastrados do trabalhador
function validarHorarioTrabalhador(id_trabalhador, data_agendamento, hora_agendamento, callback) {
  // DAYOFWEEK MySQL: 1=Dom, 2=Seg, ..., 7=Sáb → nosso padrão: 0=Dom, 1=Seg, ..., 6=Sáb
  const sql = `
    SELECT * FROM horarios_trabalhador
    WHERE id_trabalhador = ?
      AND dia_semana = (DAYOFWEEK(?) - 1)
  `;
  db.query(sql, [id_trabalhador, data_agendamento], (err, horarios) => {
    if (err) return callback(err, null);

    if (horarios.length === 0) {
      return callback(null, { valido: false, erro: 'O prestador não trabalha neste dia da semana.' });
    }

    // Verifica se a hora cai dentro de algum período
    const [hh, mm] = hora_agendamento.split(':').map(Number);
    const totalMin = hh * 60 + mm;

    const dentroDeAlgumPeriodo = horarios.some(h => {
      const [ih, im] = h.hora_inicio.split(':').map(Number);
      const [fh, fm] = h.hora_fim.split(':').map(Number);
      return totalMin >= ih * 60 + im && totalMin <= fh * 60 + fm;
    });

    if (!dentroDeAlgumPeriodo) {
      const periodos = horarios.map(h => `${h.periodo}: ${h.hora_inicio.substring(0,5)}–${h.hora_fim.substring(0,5)}`).join(', ');
      return callback(null, { valido: false, erro: `Horário fora do expediente do prestador. Períodos disponíveis: ${periodos}` });
    }

    callback(null, { valido: true });
  });
}

// Criar agendamento (apenas clientes)
app.post('/agendamentos', autenticarToken, (req, res) => {
  if (req.usuario.tipo !== 'cliente') {
    return res.status(403).json({ erro: 'Apenas clientes podem criar agendamentos.' });
  }

  const { id_servico, data_agendamento, hora_agendamento, observacao } = req.body;
  const id_cliente = req.usuario.id;

  if (!id_servico || !data_agendamento || !hora_agendamento) {
    return res.status(400).json({ erro: 'Serviço, data e hora são obrigatórios.' });
  }

  // Busca o id_trabalhador do serviço
  db.query('SELECT id_trabalhador FROM servicos WHERE id = ? AND id_cliente = ?', [id_servico, id_cliente], (err, rows) => {
    if (err || rows.length === 0) return res.status(404).json({ erro: 'Serviço não encontrado.' });

    const id_trabalhador = rows[0].id_trabalhador;

    // Valida horário contra agenda do trabalhador
    validarHorarioTrabalhador(id_trabalhador, data_agendamento, hora_agendamento, (errVal, resultado) => {
      if (errVal) { console.error(errVal); return res.status(500).json({ erro: 'Erro ao validar horário.' }); }
      if (!resultado.valido) return res.status(400).json({ erro: resultado.erro });

      const sql = `
        INSERT INTO agendamentos (id_servico, id_cliente, id_trabalhador, data_agendamento, hora_agendamento, observacao, status_agendamento)
        VALUES (?, ?, ?, ?, ?, ?, 'pendente')
      `;
      db.query(sql, [id_servico, id_cliente, id_trabalhador, data_agendamento, hora_agendamento, observacao || null], (err2, result) => {
        if (err2) { console.error(err2); return res.status(500).json({ erro: 'Erro ao salvar agendamento.' }); }
        const dataBr = data_agendamento.split('-').reverse().join('/');
        criarNotificacao(
          id_trabalhador,
          'trabalhador',
          'Novo Agendamento',
          `Um cliente agendou o serviço #${id_servico} para ${dataBr} às ${hora_agendamento}.`
        );
        res.status(201).json({ mensagem: 'Agendamento criado com sucesso!', id: result.insertId });
      });
    });
  });
});

// ==========================================
// ROTAS: HORÁRIOS DO TRABALHADOR
// ==========================================

// GET /meu-horario — retorna horários do trabalhador logado
app.get('/meu-horario', autenticarToken, (req, res) => {
  if (req.usuario.tipo !== 'trabalhador') {
    return res.status(403).json({ erro: 'Apenas trabalhadores podem acessar seus horários.' });
  }
  db.query('SELECT * FROM horarios_trabalhador WHERE id_trabalhador = ? ORDER BY dia_semana, hora_inicio', [req.usuario.id], (err, rows) => {
    if (err) { console.error(err); return res.status(500).json({ erro: 'Erro ao buscar horários.' }); }
    res.json(rows);
  });
});

// POST /meu-horario — salva (substitui) os horários do trabalhador logado
app.post('/meu-horario', autenticarToken, (req, res) => {
  if (req.usuario.tipo !== 'trabalhador') {
    return res.status(403).json({ erro: 'Apenas trabalhadores podem salvar seus horários.' });
  }

  const horarios = req.body.horarios; // array de { dia_semana, periodo, hora_inicio, hora_fim }
  if (!Array.isArray(horarios) || horarios.length === 0) {
    return res.status(400).json({ erro: 'Informe ao menos um horário com dia_semana, periodo, hora_inicio e hora_fim.' });
  }

  for (const h of horarios) {
    if (h.dia_semana === undefined || !h.hora_inicio || !h.hora_fim || !h.periodo) {
      return res.status(400).json({ erro: 'Cada horário deve ter dia_semana, periodo, hora_inicio e hora_fim.' });
    }
  }

  // Apaga os antigos e insere os novos em transação
  db.query('DELETE FROM horarios_trabalhador WHERE id_trabalhador = ?', [req.usuario.id], (errDel) => {
    if (errDel) { console.error(errDel); return res.status(500).json({ erro: 'Erro ao limpar horários antigos.' }); }

    const valores = horarios.map(h => [req.usuario.id, h.dia_semana, h.periodo, h.hora_inicio, h.hora_fim]);
    db.query(
      'INSERT INTO horarios_trabalhador (id_trabalhador, dia_semana, periodo, hora_inicio, hora_fim) VALUES ?',
      [valores],
      (errIns) => {
        if (errIns) { console.error(errIns); return res.status(500).json({ erro: 'Erro ao salvar horários.' }); }
        res.json({ mensagem: 'Horários salvos com sucesso!' });
      }
    );
  });
});

// GET /trabalhador/:id/horario — retorna horários de um trabalhador específico (para clientes ao agendar)
app.get('/trabalhador/:id/horario', autenticarToken, (req, res) => {
  db.query('SELECT * FROM horarios_trabalhador WHERE id_trabalhador = ? ORDER BY dia_semana, hora_inicio', [req.params.id], (err, rows) => {
    if (err) { console.error(err); return res.status(500).json({ erro: 'Erro ao buscar horários.' }); }
    res.json(rows);
  });
});

// Cancelar agendamento
app.put('/agendamentos/:id/cancelar', autenticarToken, (req, res) => {
  const { id } = req.params;
  const { id: userId, tipo } = req.usuario;
  const coluna = tipo === 'cliente' ? 'id_cliente' : 'id_trabalhador';

  const sql = `UPDATE agendamentos SET status_agendamento = 'cancelado' WHERE id = ? AND ${coluna} = ?`;
  db.query(sql, [id, userId], (err, result) => {
    if (err) { console.error(err); return res.status(500).json({ erro: 'Erro ao cancelar agendamento.' }); }
    if (result.affectedRows === 0) return res.status(404).json({ erro: 'Agendamento não encontrado ou sem permissão.' });

    db.query('SELECT id_cliente, id_trabalhador, data_agendamento, hora_agendamento FROM agendamentos WHERE id = ?', [id], (errA, rowsA) => {
      if (!errA && rowsA.length > 0) {
        const ag = rowsA[0];
        const destTipo = tipo === 'cliente' ? 'trabalhador' : 'cliente';
        const destId = tipo === 'cliente' ? ag.id_trabalhador : ag.id_cliente;
        const dataStr = ag.data_agendamento instanceof Date
          ? ag.data_agendamento.toISOString().split('T')[0]
          : String(ag.data_agendamento).split('T')[0];
        const dataBr = dataStr.split('-').reverse().join('/');
        const hora = String(ag.hora_agendamento || '').substring(0, 5);
        criarNotificacao(
          destId,
          destTipo,
          'Agendamento Cancelado',
          `O agendamento de ${dataBr} às ${hora} foi cancelado.`
        );
      }
    });

    res.json({ mensagem: 'Agendamento cancelado.' });
  });
});

// 4. LIGANDO O SERVIDOR
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando e escutando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
});