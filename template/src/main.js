import './style.css';
import { mount, hydrate } from '@driftjs/runtime';
import App from './App.drift';

const appElement = document.getElementById('app');

if (appElement && appElement.hasChildNodes()) {
  hydrate(App, appElement);
} else {
  mount(App, appElement);
}