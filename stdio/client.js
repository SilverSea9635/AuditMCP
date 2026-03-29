import { spawn } from 'child_process';
const child = spawn('node', ['server.js']);

process.stdin.on('data', (data) => {
  child.stdin.write(data);
})

child.stdout.on('data', (data) => {
  console.log(data.toString());
})

child.stdin.write('hello');
