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

   // Function to generate random coordinates within a radius
   function getRandomPosition(centerX, centerZ, radius = 10) {
      const angle = Math.random() * 2 * Math.PI;
      const distance = Math.random() * radius;
      const x = Math.floor(centerX + distance * Math.cos(angle));
      const z = Math.floor(centerZ + distance * Math.sin(angle));
      return { x, z };
   }

   // Function to make bot walk to a random position
   function walkToRandomPosition() {
      if (isWalking) return; // Don't start new walk if already walking
      
      const currentPos = bot.entity.position;
      const randomPos = getRandomPosition(currentPos.x, currentPos.z, 15);
      
      // Find a safe Y position (same level or slightly different)
      const y = Math.floor(currentPos.y);
      
      console.log(`[Anti-AFK] Walking to random position: (${randomPos.x}, ${y}, ${randomPos.z})`);
      
      isWalking = true;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(randomPos.x, y, randomPos.z));
   }

   // Function to start the walking behavior
   function startWalkingBehavior() {
      if (walkingInterval) {
         clearInterval(walkingInterval);
      }
      
      // Walk to a random position every 30-60 seconds
      walkingInterval = setInterval(() => {
         if (!isWalking) {
            walkToRandomPosition();
         }
      }, 30000 + Math.random() * 30000); // 30-60 seconds
      
      // Start first walk after a short delay
      setTimeout(() => {
         walkToRandomPosition();
      }, 5000);
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
         console.log('[Anti-AFK] Finished walking to random position');
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
