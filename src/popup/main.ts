import { mount } from 'svelte';
import App from './App.svelte.js';

const container = document.getElementById('app');

if (container) {
  mount(App, { target: container });
}