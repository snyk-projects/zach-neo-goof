const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const validator = require('validator');
const hms = require('humanize-ms');
const ms = require('ms');
const moment = require('moment');
const { exec } = require('child_process');
const fileType = require('file-type');
const AdmZip = require('adm-zip');
const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const ejs = require('ejs');
const Handlebars = require('handlebars');
const serialize = require('node-serialize');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: 'insecure-session-secret',
    resave: false,
    saveUninitialized: true
  })
);

// --------------------------------------------------
// Mongo
// --------------------------------------------------

mongoose.connect('mongodb://localhost:27017/vulnerable-demo');

const todoSchema = new mongoose.Schema({
  content: String,
  updated_at: Date
});

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  email: String
});

const Todo = mongoose.model('Todo', todoSchema);
const User = mongoose.model('User', userSchema);

// --------------------------------------------------
// Hardcoded secrets
// --------------------------------------------------

const API_KEY = 'sk-1234567890abcdefMockSecretForTestingOnly';
const DATABASE_PASSWORD = 'SuperSecretP@ssw0rd!';
const AWS_SECRET_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLExwJ8fM0qFDSH';
const JWT_SECRET = 'myjwtsecret1234567890';

// FAKE credential, intentionally "leaked" for secret-scanning demos.
// It matches the GitHub personal access token format but is not a real token.
const GITHUB_TOKEN = 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function isLoggedIn(req, res, next) {
  if (req.session.loggedIn === 1) {
    return next();
  }

  return res.status(401).send('Unauthorized');
}

function adminLoginSuccess(redirectPage, session, username, res) {
  session.loggedIn = 1;
  session.username = username;

  console.log(`User logged in: ${username}`);

  if (redirectPage) {
    return res.redirect(redirectPage);
  }

  return res.redirect('/admin');
}

function parse(todo) {
  let t = todo;

  const remindToken = ' in ';
  const reminder = t.toString().indexOf(remindToken);

  if (reminder > 0) {
    let time = t.slice(reminder + remindToken.length);
    time = time.replace(/\n$/, '');

    const period = hms(time);

    console.log('period: ' + period);

    t = t.slice(0, reminder);

    if (typeof period !== 'undefined') {
      t += ' [' + ms(period) + ']';
    }
  }

  return t;
}

function isBlank(str) {
  return !str || /^\s*$/.test(str);
}

// --------------------------------------------------
// Home / Todos
// --------------------------------------------------

app.get('/', async (req, res, next) => {
  try {
    const todos = await Todo.find({}).sort('-updated_at');

    res.json({
      title: 'Patch TODO List',
      subhead: 'Vulnerabilities at their best',
      todos
    });
  } catch (err) {
    next(err);
  }
});

app.post('/todos', async (req, res, next) => {
  try {
    let item = req.body.content;

    const imgRegex = /!\[.*\]\((http.*)\s".*/;

    if (typeof item === 'string' && item.match(imgRegex)) {
      const url = item.match(imgRegex)[1];

      console.log('found img: ' + url);

      // Command injection vulnerability
      exec('identify ' + url, (err, stdout, stderr) => {
        if (err !== null) {
          console.log('Error (' + err + '):' + stderr);
        }
      });
    } else {
      item = parse(item);
    }

    const todo = await new Todo({
      content: item,
      updated_at: Date.now()
    }).save();

    res
      .setHeader('Location', '/')
      .status(302)
      .send(todo.content.toString('base64'));
  } catch (err) {
    next(err);
  }
});

app.delete('/todos/:id', async (req, res, next) => {
  try {
    await Todo.findByIdAndDelete(req.params.id);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

app.put('/todos/:id', async (req, res, next) => {
  try {
    const todo = await Todo.findById(req.params.id);

    if (!todo) {
      return res.status(404).send('Todo not found');
    }

    todo.content = req.body.content;
    todo.updated_at = Date.now();

    await todo.save();

    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------
// Authentication
// --------------------------------------------------

app.get('/login', (req, res) => {
  res.send(`
    <h1>Admin Login</h1>

    <form method="POST" action="/login">
      <input name="username" placeholder="Email">
      <input name="password" type="password" placeholder="Password">
      <input
        name="redirectPage"
        type="hidden"
        value="${req.query.redirectPage || ''}"
      >

      <button type="submit">Login</button>
    </form>
  `);
});

app.post('/login', (req, res, next) => {
  if (!validator.isEmail(req.body.username)) {
    return res.status(401).send();
  }

  // Intentionally insecure plaintext password comparison
  User.find(
    {
      username: req.body.username,
      password: req.body.password
    },
    (err, users) => {
      if (err) {
        return next(err);
      }

      if (users.length > 0) {
        return adminLoginSuccess(
          req.body.redirectPage,
          req.session,
          req.body.username,
          res
        );
      }

      return res.status(401).send();
    }
  );
});

app.get('/admin', isLoggedIn, (req, res) => {
  res.send('<h1>Admin Access Granted</h1>');
});

app.post('/logout', (req, res) => {
  req.session.loggedIn = 0;

  req.session.destroy(() => {
    res.redirect('/');
  });
});

// --------------------------------------------------
// Account
// --------------------------------------------------

app.get('/account', isLoggedIn, (req, res) => {
  res.json({
    email: '',
    phone: '',
    firstname: '',
    lastname: '',
    country: ''
  });
});

app.post('/account', isLoggedIn, (req, res) => {
  const profile = req.body;

  if (
    validator.isEmail(profile.email || '', {
      allow_display_name: true
    }) &&
    validator.isMobilePhone(profile.phone || '', 'he-IL') &&
    validator.isAscii(profile.firstname || '') &&
    validator.isAscii(profile.lastname || '') &&
    validator.isAscii(profile.country || '')
  ) {
    profile.firstname = validator.rtrim(profile.firstname);
    profile.lastname = validator.rtrim(profile.lastname);

    return res.json(profile);
  }

  console.log('error in form details');

  return res.status(400).send('Invalid profile');
});

// --------------------------------------------------
// CSRF vulnerability
// --------------------------------------------------

app.post('/account/change-email', isLoggedIn, (req, res, next) => {
  const newEmail = req.body.email;

  if (!validator.isEmail(newEmail || '')) {
    return res.status(400).send('Invalid email');
  }

  // Vulnerable:
  // Authenticated state-changing POST with no CSRF token validation.
  User.findOneAndUpdate(
    { username: req.session.username },
    { email: newEmail },
    (err, user) => {
      if (err) {
        return next(err);
      }

      res.send('Email changed');
    }
  );
});

// --------------------------------------------------
// Prototype Pollution demo
// --------------------------------------------------

const users = [
  {
    name: 'user',
    password: 'pwd'
  },
  {
    name: 'admin',
    password: Math.random().toString(32),
    canDelete: true
  }
];

let messages = [];
let lastId = 1;

function findUser(auth) {
  return users.find(
    user =>
      user.name === auth.name &&
      user.password === auth.password
  );
}

app.get('/chat', (req, res) => {
  res.send(messages);
});

app.post('/chat', (req, res) => {
  const user = findUser(req.body.auth || {});

  if (!user) {
    return res
      .status(403)
      .send({
        ok: false,
        error: 'Access denied'
      });
  }

  const message = {
    icon: '👋'
  };

  // Prototype-pollution sink
  _.merge(message, req.body.message, {
    id: lastId++,
    timestamp: Date.now(),
    userName: user.name
  });

  messages.push(message);

  res.send({ ok: true });
});

app.delete('/chat', (req, res) => {
  const user = findUser(req.body.auth || {});

  if (!user || !user.canDelete) {
    return res
      .status(403)
      .send({
        ok: false,
        error: 'Access denied'
      });
  }

  messages = messages.filter(
    message => message.id !== req.body.messageId
  );

  res.send({ ok: true });
});

// --------------------------------------------------
// Additional intentionally vulnerable endpoints (demo only)
// --------------------------------------------------

// Insecure deserialization -> RCE (node-serialize CVE-2017-5941)
app.post('/profile/import', (req, res) => {
  const profile = serialize.unserialize(req.body.data);
  res.json(profile);
});

// Eval injection -> RCE
app.get('/calc', (req, res) => {
  res.send(String(eval(req.query.expr)));
});

// Path traversal -> arbitrary file read
app.get('/download', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.query.file);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      return res.status(404).send('Not found');
    }
    res.send(data);
  });
});

// Zip Slip -> arbitrary file write (old adm-zip)
app.post('/unzip', (req, res) => {
  const zip = new AdmZip(req.body.zipPath);
  zip.extractAllTo(req.body.destination || './uploads', true);
  res.send('Extracted');
});

// SSRF -> internal network / cloud metadata access
app.get('/fetch', async (req, res, next) => {
  try {
    const response = await axios.get(req.query.url);
    res.send(response.data);
  } catch (err) {
    next(err);
  }
});

// NoSQL injection via $where and unsanitized query operators
app.get('/search', async (req, res, next) => {
  try {
    const todos = await Todo.find({
      $where: "this.content.indexOf('" + req.query.q + "') !== -1"
    });
    res.json(todos);
  } catch (err) {
    next(err);
  }
});

// Server-side template injection (ejs / handlebars)
app.get('/render/ejs', (req, res) => {
  res.send(ejs.render(req.query.template || '', { user: req.session.username }));
});

app.get('/render/hbs', (req, res) => {
  const template = Handlebars.compile(req.query.template || '');
  res.send(template({ user: req.session.username }));
});

// Weak hashing (MD5, unsalted) and hardcoded secret use
app.post('/register', (req, res, next) => {
  const hashed = crypto
    .createHash('md5')
    .update(req.body.password || '')
    .digest('hex');

  new User({
    username: req.body.username,
    password: hashed,
    email: req.body.email
  })
    .save()
    .then(() => res.send('Registered'))
    .catch(next);
});

// Calls an external API with the leaked token
app.get('/repos', async (req, res, next) => {
  try {
    const response = await axios.get('https://api.github.com/user/repos', {
      headers: { Authorization: 'token ' + GITHUB_TOKEN }
    });
    res.json(response.data);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------
// About
// --------------------------------------------------

app.get('/about', (req, res) => {
  console.log(JSON.stringify(req.query));

  res.send(`
    <h1>Patch TODO List</h1>
    <p>Vulnerabilities at their best</p>
    <p>Device: ${req.query.device || ''}</p>
  `);
});

// --------------------------------------------------
// Error handler
// --------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).send({
    error: err.message
  });
});

// --------------------------------------------------
// Start
// --------------------------------------------------

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Vulnerable demo app running on http://localhost:${PORT}`);
});