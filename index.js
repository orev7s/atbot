#!/usr/bin/env node

const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;

const config = require('./settings.json');
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

app.listen(5000, () => {
  console.log('Server started on port 5000');
});

function createBot() {
   const bot = mineflayer.createBot({
      username: config['bot-account']['username'],
      host: config.server.ip,
      port: config.server.port,
      version: config.server.version,
   });

   bot.loadPlugin(pathfinder);
   const mcData = require('minecraft-data')(bot.version);
   const defaultMove = new Movements(bot, mcData);

   let pendingPromise = Promise.resolve();
   let walkingInterval = null;
   let isWalking = false;
   let lastDirection = null;
   let lastDistance = null;
   let blockedAttempts = 0;
   const maxBlockedAttempts = 5;

   // Function to generate random coordinates within a radius
   function getRandomPosition(centerX, centerZ, radius = 10) {
      const angle = Math.random() * 2 * Math.PI;
      const distance = Math.random() * radius;
      const x = Math.floor(centerX + distance * Math.cos(angle));
      const z = Math.floor(centerZ + distance * Math.sin(angle));
      return { x, z };
   }

   // Function to get a random direction that's different from the last one
   function getRandomDirection() {
      const directions = ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'];
      let availableDirections = directions.filter(dir => dir !== lastDirection);
      
      if (availableDirections.length === 0) {
         availableDirections = directions; // If all directions were used, reset
      }
      
      const randomDir = availableDirections[Math.floor(Math.random() * availableDirections.length)];
      lastDirection = randomDir;
      return randomDir;
   }

   // Function to get a random distance that's different from the last one
   function getRandomDistance() {
      let distance;
      do {
         distance = Math.floor(Math.random() * 15) + 1; // 1 to 15 blocks
      } while (distance === lastDistance);
      
      lastDistance = distance;
      return distance;
   }

   // Function to convert direction to coordinates
   function directionToCoordinates(direction, distance) {
      const currentPos = bot.entity.position;
      let x = Math.floor(currentPos.x);
      let z = Math.floor(currentPos.z);
      
      switch (direction) {
         case 'north':
            z -= distance;
            break;
         case 'south':
            z += distance;
            break;
         case 'east':
            x += distance;
            break;
         case 'west':
            x -= distance;
            break;
         case 'northeast':
            x += Math.floor(distance * 0.707);
            z -= Math.floor(distance * 0.707);
            break;
         case 'northwest':
            x -= Math.floor(distance * 0.707);
            z -= Math.floor(distance * 0.707);
            break;
         case 'southeast':
            x += Math.floor(distance * 0.707);
            z += Math.floor(distance * 0.707);
            break;
         case 'southwest':
            x -= Math.floor(distance * 0.707);
            z += Math.floor(distance * 0.707);
            break;
      }
      
      return { x: Math.floor(x), z: Math.floor(z) };
   }

   // Function to make bot walk to a random position
   function walkToRandomPosition() {
      if (isWalking) return; // Don't start new walk if already walking
      
      const direction = getRandomDirection();
      const distance = getRandomDistance();
      const coords = directionToCoordinates(direction, distance);
      const y = Math.floor(bot.entity.position.y);
      
      console.log(`[Anti-AFK] Walking ${distance} blocks ${direction} to: (${coords.x}, ${y}, ${coords.z})`);
      
      isWalking = true;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(coords.x, y, coords.z));
   }

   // Function to handle blocked movement
   function handleBlockedMovement() {
      console.log('[Anti-AFK] Movement blocked, trying different direction...');
      blockedAttempts++;
      
      if (blockedAttempts >= maxBlockedAttempts) {
         console.log('[Anti-AFK] Too many blocked attempts, resetting direction history');
         lastDirection = null;
         lastDistance = null;
         blockedAttempts = 0;
      }
      
      // Reset walking state and try again
      isWalking = false;
      setTimeout(() => {
         walkToRandomPosition();
      }, 1000);
   }

   // Function to start the walking behavior
   function startWalkingBehavior() {
      if (walkingInterval) {
         clearInterval(walkingInterval);
      }
      
      // Walk to a random position every 2-5 seconds for constant movement
      walkingInterval = setInterval(() => {
         if (!isWalking) {
            walkToRandomPosition();
         }
      }, 2000 + Math.random() * 3000); // 2-5 seconds
      
      // Start first walk immediately
      walkToRandomPosition();
   }

   function sendRegister(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/register ${password} ${password}`);
         console.log(`[Auth] Sent /register command.`);

         bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`); // Log all chat messages

            // Check for various possible responses
            if (message.includes('successfully registered')) {
               console.log('[INFO] Registration confirmed.');
               resolve();
            } else if (message.includes('already registered')) {
               console.log('[INFO] Bot was already registered.');
               resolve(); // Resolve if already registered
            } else if (message.includes('Invalid command')) {
               reject(`Registration failed: Invalid command. Message: "${message}"`);
            } else {
               reject(`Registration failed: unexpected message "${message}".`);
            }
         });
      });
   }

   function sendLogin(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/login ${password}`);
         console.log(`[Auth] Sent /login command.`);

         bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`); // Log all chat messages

            if (message.includes('successfully logged in')) {
               console.log('[INFO] Login successful.');
               resolve();
            } else if (message.includes('Invalid password')) {
               reject(`Login failed: Invalid password. Message: "${message}"`);
            } else if (message.includes('not registered')) {
               reject(`Login failed: Not registered. Message: "${message}"`);
            } else {
               reject(`Login failed: unexpected message "${message}".`);
            }
         });
      });
   }

   bot.once('spawn', () => {
      console.log('\x1b[33m[AfkBot] Bot joined the server', '\x1b[0m');

      if (config.utils['auto-auth'].enabled) {
         console.log('[INFO] Started auto-auth module');

         const password = config.utils['auto-auth'].password;

         pendingPromise = pendingPromise
            .then(() => sendRegister(password))
            .then(() => sendLogin(password))
            .catch(error => console.error('[ERROR]', error));
      }

      if (config.utils['chat-messages'].enabled) {
         console.log('[INFO] Started chat-messages module');
         const messages = config.utils['chat-messages']['messages'];

         if (config.utils['chat-messages'].repeat) {
            const delay = config.utils['chat-messages']['repeat-delay'];
            let i = 0;

            let msg_timer = setInterval(() => {
               bot.chat(`${messages[i]}`);

               if (i + 1 === messages.length) {
                  i = 0;
               } else {
                  i++;
               }
            }, delay * 1000);
         } else {
            messages.forEach((msg) => {
               bot.chat(msg);
            });
         }
      }

      const pos = config.position;

      if (config.position.enabled) {
         console.log(
            `\x1b[32m[Afk Bot] Starting to move to target location (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`
         );
         bot.pathfinder.setMovements(defaultMove);
         bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
      }

      if (config.utils['anti-afk'].enabled) {
         console.log('[INFO] Started anti-afk module with walking behavior');
         
         // Always enable sneaking for all movement
         bot.setControlState('sneak', true);
         console.log('[Anti-AFK] Sneaking enabled for all movement');
         
         // Start the walking behavior
         startWalkingBehavior();
      }
   });

   bot.on('goal_reached', () => {
      console.log(
         `\x1b[32m[AfkBot] Bot arrived at the target location. ${bot.entity.position}\x1b[0m`
      );
      
      // If this was part of anti-afk walking, mark as not walking anymore
      if (isWalking) {
         isWalking = false;
         blockedAttempts = 0; // Reset blocked attempts on successful movement
         console.log('[Anti-AFK] Finished walking to random position');
      }
   });

   // Handle when bot can't reach the goal (blocked)
   bot.on('goal_updated', (goal) => {
      if (isWalking) {
         console.log('[Anti-AFK] Goal updated, checking if blocked...');
      }
   });

   // Handle when bot gives up on a goal (blocked)
   bot.on('path_update', (results) => {
      if (isWalking && results.status === 'noPath') {
         console.log('[Anti-AFK] No path found, bot is blocked');
         handleBlockedMovement();
      }
   });

   // Handle when bot gets stuck
   bot.on('move', () => {
      if (isWalking) {
         // Reset blocked attempts when bot is actually moving
         blockedAttempts = 0;
      }
   });

   bot.on('death', () => {
      console.log(
         `\x1b[33m[AfkBot] Bot has died and was respawned at ${bot.entity.position}`,
         '\x1b[0m'
      );
      
      // Restart walking behavior after respawn
      if (config.utils['anti-afk'].enabled) {
         setTimeout(() => {
            bot.setControlState('sneak', true);
            startWalkingBehavior();
         }, 3000);
      }
   });

   if (config.utils['auto-reconnect']) {
      bot.on('end', () => {
         // Clear walking interval when bot disconnects
         if (walkingInterval) {
            clearInterval(walkingInterval);
            walkingInterval = null;
         }
         
         setTimeout(() => {
            createBot();
         }, config.utils['auto-recconect-delay']);
      });
   }

   bot.on('kicked', (reason) =>
      console.log(
         '\x1b[33m',
         `[AfkBot] Bot was kicked from the server. Reason: \n${reason}`,
         '\x1b[0m'
      )
   );

   bot.on('error', (err) =>
      console.log(`\x1b[31m[ERROR] ${err.message}`, '\x1b[0m')
   );
}

createBot();
