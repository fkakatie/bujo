const APP_ID = 'AKfycbzU62vPsIIWig3QD8sbAsid6YUiAhvC7Yh2w8fhYpNJZF45j3j-z2ck6h03lOXE1jrf';
const APP_URL = `https://script.google.com/macros/s/${APP_ID}/exec`;

// utilities
/**
 * Builds an HTML DOM element.
 * @param {string} tag The type of element
 * @param {object} params Additional parameters for element
 * @returns {Element} The block element
 */
function createEl(tag, params) {
  const el = document.createElement(tag);
  if (params) {
    Object.keys(params).forEach((param) => {
      if (param === 'html') el.innerHTML = params[param];
      else if (param === 'text') el.textContent = params[param];
      else el.setAttribute(param, params[param]);
    });
  }
  return el;
}

async function buildIcon(str) {
  const src = str.endsWith('.svg') ? str : `assets/icons/${str}.svg`;
  try {
    const resp = await fetch(src);
    const svg = await resp.text();
    const icon = createEl('i', {
      html: svg,
      class: 'icon',
    });
    const name = icon.querySelector('svg').id;
    if (name) icon.classList.add(`icon-${name}`);
    return icon;
  } catch (error) {
    console.error(`No icon found at "${src}":`, error);
    return null;
  }
}

function swapIcons(el) {
  el.querySelectorAll('img[data-type="icon"][src]').forEach(async (iconImg) => {
    const { pathname } = new URL(iconImg.src);
    const icon = await buildIcon(pathname);
    if (icon) iconImg.replaceWith(icon);
  });
}

async function fetchFragment(fragmentName) {
  try {
    const resp = await fetch(`fragments/${fragmentName}.html`);
    const fragmentText = await resp.text();
    let fragment = createEl('div', { html: fragmentText });
    // check if fragment is self-contained in a wrapping element
    const wrapped = fragment.firstElementChild === fragment.lastElementChild;
    if (wrapped) fragment = fragment.firstElementChild;
    fragment.dataset.source = 'fragment';
    swapIcons(fragment);
    return fragment;
  } catch (error) {
    console.error(`No "${fragmentName}" fragment found:`, error);
    return '';
  }
}

function auth() {
  return localStorage.getItem('bujo-key');
}

// gapi scripts
async function gapi(params, key = auth(), method = 'GET') {
  // build url
  let url = `${APP_URL}?key=${key}`;
  // eslint-disable-next-line no-return-assign
  Object.keys(params).forEach((param) => url += `&${param}=${encodeURIComponent(params[param])}`);
  const req = await fetch(url, { method });
  const res = await req.json();
  if (res.statusCode > 400) {
    console.error(`API ${method} request failed:`, res.error);
  }
  return res;
}

async function fetchTasks() {
  if (!window.tasks) {
    const tasks = {};
    const habits = await gapi({ sheet: 'habit' });
    if (habits.data) {
      // eslint-disable-next-line no-return-assign
      habits.data.forEach((habit) => tasks[habit.id] = habit);
    }
    const chores = await gapi({ sheet: 'chores' });
    if (chores.data) {
      // eslint-disable-next-line no-return-assign
      chores.data.forEach((chore) => tasks[chore.id] = chore);
    }
    window.tasks = tasks;
  }
  return window.tasks;
}

function returnYMD(date) {
  const yy = date.getFullYear().toString().slice(2);
  const mm = date.getMonth().toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  return { yy, mm, dd };
}

async function fetchCompletedTasks() {
  if (!window.bujoComplete) {
    const tracker = await gapi({ sheet: 'tracker' });
    const log = {};
    tracker.data.forEach((row) => {
      const timestamp = new Date(row.timestamp);
      const { yy, mm, dd } = returnYMD(timestamp);
      const monthKey = `m${mm}`;
      const dateKey = `d${mm}${dd}${yy}`;
      // check if month
      if (log[monthKey]) {
        // check if date
        if (log[monthKey][dateKey]) {
          log[monthKey][dateKey].push(row);
        } else {
          log[monthKey][dateKey] = [row];
        }
      } else {
        log[monthKey] = {};
        log[monthKey][dateKey] = [row];
      }
      window.bujoComplete = log;
      return window.bujoComplete;
    });
    return log;
  }
  return window.bujoComplete;
}

async function filterCompletedTasks(date = new Date()) {
  const timestamp = date;
  const { yy, mm, dd } = returnYMD(timestamp);
  const monthKey = `m${mm}`;
  const log = await fetchCompletedTasks();
  if (log[monthKey]) {
    const dateKey = `d${mm}${dd}${yy}`;
    const monthLog = log[monthKey];
    if (monthLog[dateKey]) return monthLog[dateKey];
  }
  return [];
}

async function completeTask(id, frequency, time = '') {
  const resp = await gapi({ id, frequency, time }, auth(), 'POST');
  console.log(resp.id, resp.message);
}

// dom builders
function buildTask(el, task) {
  // populate body
  const icon = el.querySelector('.task-icon');
  icon.textContent = task.icon;
  const eyebrow = el.querySelector('.task-eyebrow');
  eyebrow.textContent = `${task.room} • ~${task.mins} minutes`;
  const title = el.querySelector('.task-title');
  title.textContent = task.task;
  // populate form
  const form = el.querySelector('.task-form');
  const label = form.querySelector('label');
  label.setAttribute('for', task.id);
  label.setAttribute('aria-label', `mark ${task.task} complete`);
  const input = form.querySelector('input');
  input.id = task.id;
  input.setAttribute('name', task.id);
  const checkbox = form.querySelector('.task-checkbox');
  input.addEventListener('change', () => {
    if (input.checked) {
      checkbox.dataset.animate = true;
      // eslint-disable-next-line no-param-reassign
      el.dataset.animate = true;
      input.disabled = true;
      // update spreadsheet
      console.log(`TASK ${task.id}:`, task.task);
      completeTask(task.id, task.freq);
    } else {
      checkbox.removeAttribute('data-animate');
      el.removeAttribute('data-animate');
    }
  });
  // add attributes
  Object.keys(task).forEach((key) => {
    // eslint-disable-next-line no-param-reassign
    if (task[key] !== '') el.dataset[key] = task[key];
  });
  return el;
}

async function refreshTasks(dateText, day, date, index) {
  const week = document.querySelector('.week');
  const todayIndex = parseInt(week.dataset.today, 10);
  const future = index > todayIndex;
  // update header
  const today = todayIndex === index;
  const yesterday = todayIndex - index === 1;
  const tomorrow = todayIndex + 1 === index;
  const heading = document.querySelector('header h1');
  // eslint-disable-next-line no-nested-ternary
  heading.textContent = today ? 'today' : yesterday ? 'yesterday' : tomorrow ? 'tomorrow' : dateText;
  // clear all tasks
  day.querySelectorAll('.task[data-id]').forEach((task) => {
    const cb = task.querySelector('input');
    // eslint-disable-next-line no-param-reassign
    cb.disabled = false;
    // eslint-disable-next-line no-param-reassign
    cb.checked = false;
    // eslint-disable-next-line no-param-reassign
    cb.disabled = future; // disable selecting tasks for future dates
  });
  // mark completed tasks
  const filtered = await filterCompletedTasks(date);
  filtered.forEach((task) => {
    const checkbox = day.querySelector(`.task[data-id="${task.taskId}"] input`);
    if (checkbox) {
      // this will NOT trigger the 'change' event
      checkbox.checked = true;
      checkbox.disabled = true;
    }
  });
}

async function buildWeek() {
  const week = await fetchFragment('week-view');
  const days = week.querySelectorAll('.day-of-week');
  const today = new Date().toString().toLowerCase();
  const date = new Date();
  let str = date.toString().toLowerCase();
  // find start of week (monday)
  while (!str.startsWith('mon')) {
    date.setDate(date.getDate() - 1);
    str = date.toString().toLowerCase();
  }
  let todayIndex = 0;
  days.forEach((day, i) => {
    const dateStr = date.toString().toLowerCase();
    if (today.slice(0, 15) === dateStr.slice(0, 15)) {
      todayIndex = i;
      day.setAttribute('aria-selected', true);
    }
    const { yy, mm, dd } = returnYMD(date);
    // eslint-disable-next-line no-param-reassign
    day.dataset.mkey = `m${mm}`;
    // eslint-disable-next-line no-param-reassign
    day.dataset.dkey = `d${mm}${dd}${yy}`;
    // eslint-disable-next-line no-param-reassign
    day.dataset.index = i;
    const text = day.querySelector('.day-text');
    text.textContent = dateStr.slice(0, 2);
    const num = day.querySelector('.day-num');
    num.textContent = date.getDate();
    day.addEventListener('click', () => {
      // select button
      days.forEach((d) => d.setAttribute('aria-selected', false));
      day.setAttribute('aria-selected', true);
      // reset day with completed tasks
      const [m, d, y] = day.dataset.dkey.replace('d', '').match(/.{1,2}/g).map((char) => parseInt(char, 10));
      refreshTasks(
        day.dataset.day, // date text
        document.querySelector('.day'), // day el containing tasks
        new Date(`${m + 1}/${d}/${y}`), // date to filter by
        parseInt(day.dataset.index, 10), // index of date to filter by
      );
    });
    // set date to next day
    date.setDate(date.getDate() + 1);
  });
  week.dataset.today = todayIndex;
  return week;
}

async function buildDashboard(main) {
  // eslint-disable-next-line no-param-reassign
  main.dataset.view = 'dash';

  // update header
  const header = document.querySelector('header');
  header.querySelector('h1').textContent = 'today';
  const week = await buildWeek();
  header.append(week);

  const day = createEl('section', { class: 'day', 'data-status': 'loading' });
  main.append(day);

  // add dummy tasks if no data loaded
  const taskTemplate = await fetchFragment('task');
  const buildDummyTask = () => {
    const task = taskTemplate.cloneNode(true);
    task.classList.add('task-dummy');
    task.querySelector('input').name = 'dummy';
    day.append(task);
  };
  const timer = setInterval(buildDummyTask, 1000 * 0.3);

  // fetch tasks
  const tasks = await fetchTasks();
  setTimeout(() => clearInterval(timer));
  const dummies = day.querySelectorAll('.task-dummy');
  // add tasks
  Object.keys(tasks).forEach((id, i) => {
    const el = buildTask(taskTemplate.cloneNode(true), tasks[id]);
    if (dummies[i]) dummies[i].replaceWith(el);
    else day.append(el);
  });
  dummies.forEach((dummy) => dummy.remove());

  // mark completed tasks
  const filtered = await filterCompletedTasks();
  filtered.forEach((task) => {
    const checkbox = day.querySelector(`.task[data-id="${task.taskId}"] input`);
    if (checkbox) {
      // this will NOT trigger the 'change' event
      checkbox.checked = true;
      checkbox.disabled = true;
    }
  });
  day.dataset.status = 'loaded';
}

async function login(key, button) {
  // eslint-disable-next-line no-param-reassign
  button.dataset.status = 'authenticating';
  const spinner = await buildIcon('spinner');
  button.append(spinner);
  const keys = await gapi({}, key);
  button.removeAttribute('data-status');
  spinner.remove();
  if (keys && keys.key) {
    // successful login
    localStorage.setItem('bujo-key', keys.key);
    localStorage.setItem('bujo-weather', keys.weather);
  }
  return auth();
}

async function buildLogin(main) {
  const loginForm = await fetchFragment('login');
  loginForm.classList.add('login');
  // setup input
  const input = loginForm.querySelector('input');
  const label = loginForm.querySelector('label');
  if (input && label) {
    // eslint-disable-next-line no-return-assign
    input.addEventListener('focus', () => label.dataset.status = 'hidden');
    input.addEventListener('blur', () => {
      if (!input.value) label.dataset.status = 'visible';
    });
  }
  // setup password toggle
  const toggle = loginForm.querySelector('#toggle-password');
  if (toggle && input) {
    toggle.addEventListener('click', () => {
      const selected = toggle.getAttribute('aria-selected') === 'true';
      if (selected) input.setAttribute('type', 'password');
      else input.setAttribute('type', 'text');
      toggle.setAttribute('aria-selected', !selected);
    });
  }
  // setup sumbmit
  const submit = loginForm.querySelector('#submit');
  if (input && submit) {
    input.setAttribute('type', 'password');
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim().length > 0) {
        login(input.value.trim(), submit).then((authenticated) => {
          if (authenticated) {
            loginForm.remove();
            buildDashboard(main);
          } else {
            loginForm.querySelector('form').classList.add('invalid');
            input.value = '';
          }
        });
      }
    });
  }
  main.append(loginForm);
}

function init() {
  swapIcons(document.body);
  document.body.dataset.status = 'loaded';

  const authenticated = auth();
  const main = document.querySelector('main');
  if (authenticated) {
    buildDashboard(main);
  } else {
    main.dataset.view = 'login';
    buildLogin(main);
  }
}

document.addEventListener('DOMContentLoaded', init);
