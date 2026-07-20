import './style.css';
import { mount } from 'driftjs';
import App from './App.drift';

const appElement = document.getElementById('app')!;
mount(App, appElement);