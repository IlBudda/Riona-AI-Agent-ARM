import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import type { ElementHandle } from "puppeteer";
import { IGpassword, IGusername } from "../secret";
import logger from "../config/logger";
import { Instagram_cookiesExist, loadCookies, saveCookies } from "../utils";
import { runAgent } from "../Agent";
import { getInstagramCommentSchema } from "../Agent/schema";
import { Server } from "proxy-chain";
import { 
  INSTAGRAM_CONFIG, 
  isWithinWorkingHours as configIsWithinWorkingHours, 
  getTimeUntilWorkingHours as configGetTimeUntilWorkingHours,
  getRandomDelay,
  shouldWork,
  isWorkDay
} from "../config/instagram";

// Utilizza direttamente la configurazione importata
const CONFIG = INSTAGRAM_CONFIG;

// Add plugins
puppeteer.use(StealthPlugin());
puppeteer.use(
  AdblockerPlugin({
    interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
  })
);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Utilizza le funzioni di controllo orario dal file di configurazione
const isWithinWorkingHours = configIsWithinWorkingHours;
const getTimeUntilWorkingHours = configGetTimeUntilWorkingHours;

// Function to check if a post is sponsored
async function isSponsoredPost(page: any, postSelector: string): Promise<boolean> {
  return await page.evaluate((selector: string) => {
    const post = document.querySelector(selector);
    if (!post) return false;
    
    const sponsoredTexts = [
      'sponsored', 'sponsorizzato', 'ad', 'promoted', 
      'pubblicità', 'annuncio', 'promosso'
    ];
    
    // 1. Cerca elementi con attributi specifici di Instagram Ads
    const adSelectors = [
      '[data-ad-preview="message"]',
      '[aria-label*="Sponsored"]',
      '[aria-label*="Sponsorizzato"]',
      '[data-testid*="ad"]',
      '[role*="ad"]',
      'a[href*="/ads/"]',
      'a[href*="/pubblicità/"]'
    ];
    
    for (const selector of adSelectors) {
      const adElements = post.querySelectorAll(selector);
      if (adElements.length > 0) {
        console.log('DEBUG - Found ad element with selector:', selector);
        return true;
      }
    }
    
    // 2. Cerca SOLO nell'header del post (dove appare "Sponsored")
    const header = post.querySelector('header');
    if (header) {
      const headerText = header.textContent?.toLowerCase() || '';
      
      // DEBUG: Log per vedere cosa contiene l'header
      console.log('DEBUG - Header content:', headerText.substring(0, 100) + '...');
      
      // Cerca solo nell'header, non in tutto il post
      for (const text of sponsoredTexts) {
        if (headerText.includes(text)) {
          console.log('DEBUG - Found sponsored in header:', text);
          return true;
        }
      }
      
      // Cerca anche in elementi specifici dell'header
      const headerElements = header.querySelectorAll('span, div, p, a');
      for (const element of headerElements) {
        const elementText = element.textContent?.toLowerCase() || '';
        for (const text of sponsoredTexts) {
          if (elementText.includes(text)) {
            console.log('DEBUG - Found sponsored in header element:', text);
            return true;
          }
        }
        
        // Cerca in aria-label degli elementi dell'header
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
          const ariaLabelLower = ariaLabel.toLowerCase();
          for (const text of sponsoredTexts) {
            if (ariaLabelLower.includes(text)) {
              console.log('DEBUG - Found sponsored in aria-label:', ariaLabel);
              return true;
            }
          }
        }
      }
    }
    
    // 3. Cerca testo "Sponsorizzato" in elementi specifici (non in tutto il post)
    const sponsorTextElements = post.querySelectorAll('span, div, p, a');
    for (const element of sponsorTextElements) {
      const text = element.textContent?.toLowerCase() || '';
      if (text.includes('sponsorizzato') || text.includes('sponsored')) {
        // Verifica che non sia testo casuale del post - controlla contesto
        const isInHeader = element.closest('header');
        const htmlElement = element as HTMLElement;
        const isSmallText = htmlElement.offsetHeight <= 20; // Testo piccolo tipico degli ads
        const style = window.getComputedStyle(htmlElement);
        const isGrayText = style.color.includes('128, 128, 128') || 
                          style.color.includes('#808080') ||
                          style.color.includes('rgb(142, 142, 142)');
        
        if (isInHeader || isSmallText || isGrayText) {
          console.log('DEBUG - Found sponsored text in likely ad context');
          return true;
        }
      }
    }
    
    console.log('DEBUG - Post is NOT sponsored');
    return false;
  }, postSelector);
}

async function runInstagram() {
  let server: Server | null = null;
  let browser: any = null;

  while (true) {
    try {
      // Check if we should work today (day + hours)
      if (!shouldWork()) {
        if (!isWorkDay()) {
          const dayNames = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
          const dayName = dayNames[new Date().getDay()];
          console.log(`📅 Oggi è ${dayName} - giorno non lavorativo. Riposo fino a domani.`);
          await delay(24 * 60 * 60 * 1000); // Aspetta 24 ore
          continue;
        }
        
        // Se siamo qui, il giorno è ok ma non l'orario (solo se USE_WORKING_HOURS è true)
        if (CONFIG.WORK_SCHEDULE.USE_WORKING_HOURS) {
          const waitTime = getTimeUntilWorkingHours();
          const waitHours = Math.floor(waitTime / (1000 * 60 * 60));
          const waitMinutes = Math.floor((waitTime % (1000 * 60 * 60)) / (1000 * 60));
          
          logger.info(`Outside working hours. Sleeping for ${waitHours}h ${waitMinutes}m until next working period.`);
          console.log(`🌙 No browser needed. Sleeping until working hours. Current time: ${new Date().toLocaleTimeString()}`);
          
          await delay(waitTime);
          continue;
        }
      }

      // We're in working hours - start browser and work session
      logger.info(`🌅 Starting work session at ${new Date().toLocaleTimeString()}`);
      
      // Setup proxy server
      server = new Server({ port: 8000 });
      await server.listen();
      const proxyUrl = "http://localhost:8000";

      const launchArgs = {
        executablePath: "/usr/bin/chromium-browser",
        headless: false,
        args: [
          `--proxy-server=${proxyUrl}`,
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--start-maximized",
        ],
      };

      browser = await puppeteer.launch(launchArgs);

      const page = await browser.newPage();
      const cookiesPath = "./cookies/Instagramcookies.json";

      const checkCookies = await Instagram_cookiesExist();
      logger.info(`Checking cookies existence: ${checkCookies}`);

      if (checkCookies) {
        const cookies = await loadCookies(cookiesPath);
        await page.setCookie(...cookies);
        logger.info("Cookies loaded and set on the page.");
        await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });

        const isLoggedIn = await page.$("a[href='/direct/inbox/']");
        if (isLoggedIn) {
          logger.info("Login verified with cookies.");
          await page.screenshot({ path: "logged_in.png" });
          await page.goto("https://www.instagram.com/");
        } else {
          logger.warn("Cookies invalid or expired. Logging in again...");
          await loginWithCredentials(page, browser);
        }
      } else {
        await loginWithCredentials(page, browser);
      }

      // Work session loop - continue while shouldWork() returns true
      while (shouldWork()) {
        logger.info(`🔥 Working session active. Starting interaction cycle at ${new Date().toLocaleTimeString()}`);
        
        try {
          await interactWithPosts(page);
        } catch (error) {
          logger.error("Error during interaction:", error);
          // Continue working even if there's an error
        }
        
        // Check if we should still work after interaction
        if (shouldWork()) {
          logger.info(`Interaction cycle complete, waiting ${CONFIG.DELAYS.AFTER_INTERACTION / 1000} seconds before refreshing...`);
          await delay(CONFIG.DELAYS.AFTER_INTERACTION);
          try {
            await page.reload({ waitUntil: "networkidle2" });
          } catch (e) {
            logger.warn("Error reloading page: " + e);
          }
        }
      }

      // Work session ended
      logger.info(`🌙 Work session ended at ${new Date().toLocaleTimeString()}. Closing browser and going to sleep.`);
      
    } catch (error) {
      logger.error("Error during Instagram session:", error);
    } finally {
      // CHIUSURA GARANTITA - Questo risolve il memory leak
      if (browser) {
        try {
          await browser.close();
          browser = null;
          console.log("✅ Browser closed successfully.");
        } catch (e) {
          logger.error("Error closing browser:", e);
        }
      }
      
      if (server) {
        try {
          await server.close(true);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for complete closure
          server = null;
          console.log("✅ Proxy server closed successfully.");
        } catch (e) {
          logger.error("Error closing proxy server:", e);
        }
      }
    }
    
    // Pausa prima del prossimo ciclo
    await delay(5000);
  }
}

const loginWithCredentials = async (page: any, browser: any) => {
  try {
    await page.goto("https://www.instagram.com/accounts/login/");
    await page.waitForSelector('input[name="username"]');
    await page.type('input[name="username"]', IGusername);
    await page.type('input[name="password"]', IGpassword);
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    const cookies = await browser.cookies();
    await saveCookies("./cookies/Instagramcookies.json", cookies);
    await page.screenshot({ path: "logged_in.png" });
    await page.goto("https://www.instagram.com/");
  } catch (error) {
    logger.error("Error logging in with credentials:", error);
  }
};

async function interactWithPosts(page: any) {
  let postIndex = 1;
  const maxPosts = CONFIG.MAX_POSTS_PER_SESSION;

  while (postIndex <= maxPosts) {
    try {
      const postSelector = `article:nth-of-type(${postIndex})`;
      if (!(await page.$(postSelector))) {
        console.log("No more posts found. Ending iteration...");
        return;
      }

      // Check if post is sponsored before interacting
      const isSponsored = await isSponsoredPost(page, postSelector);
      if (isSponsored) {
        console.log(`Post ${postIndex} is sponsored. Skipping...`);
        postIndex++;
        continue; // Skip to next post
      }

      // LIKE FUNCTIONALITY - Simplified approach
      console.log(`Attempting to like post ${postIndex}...`);
      const likeResult = await page.evaluate((selector: string) => {
        const post = document.querySelector(selector);
        if (!post) return { success: false, reason: "Post not found" };

        // Find like button - try multiple selectors
        const selectors = [
          'svg[aria-label="Like"]',
          'svg[aria-label="Mi piace"]',
          'button[aria-label="Like"]',
          'button[aria-label="Mi piace"]',
          '*[aria-label*="Like"]',
          '*[aria-label*="Mi piace"]'
        ];

        let likeElement = null;
        for (const sel of selectors) {
          likeElement = post.querySelector(sel);
          if (likeElement) break;
        }

        if (!likeElement) {
          return { success: false, reason: "Like button not found" };
        }

        // Get the clickable parent (button)
        const clickTarget = likeElement.closest('button') || 
                           likeElement.closest('[role="button"]') || 
                           likeElement;

        const ariaLabel = clickTarget.getAttribute('aria-label') || 
                         likeElement.getAttribute('aria-label');

        if (ariaLabel && (ariaLabel.includes('Unlike') || ariaLabel.includes('Non mi piace più'))) {
          return { success: false, reason: "Already liked" };
        }

        // Click the like button
        (clickTarget as HTMLElement).click();
        return { success: true, reason: "Clicked successfully" };
      }, postSelector);

      if (likeResult.success) {
        console.log(`Post ${postIndex} liked successfully.`);
        await delay(CONFIG.DELAYS.AFTER_LIKE);
      } else {
        console.log(`Like failed for post ${postIndex}: ${likeResult.reason}`);
      }

      // GET CAPTION
      const captionSelector = `${postSelector} div.x9f619 span._ap3a div span._ap3a`;
      const captionElement = await page.$(captionSelector);

      let caption = "";
      if (captionElement) {
        caption = await captionElement.evaluate((el: HTMLElement) => el.innerText);
        console.log(`Caption for post ${postIndex}: ${caption}`);
      } else {
        console.log(`No caption found for post ${postIndex}.`);
      }

      // Expand caption if needed
      const moreLinkSelector = `${postSelector} div.x9f619 span._ap3a span div span.x1lliihq`;
      const moreLink = await page.$(moreLinkSelector);
      if (moreLink) {
        console.log(`Expanding caption for post ${postIndex}...`);
        await moreLink.click();
        await delay(CONFIG.DELAYS.EXPAND_CAPTION);
        if (captionElement) {
          const expandedCaption = await captionElement.evaluate(
            (el: HTMLElement) => el.innerText
          );
          console.log(`Expanded Caption for post ${postIndex}: ${expandedCaption}`);
          caption = expandedCaption;
        }
      }

      // COMMENT FUNCTIONALITY - Simplified approach
      const commentBoxSelector = `${postSelector} textarea`;
      const commentBox = await page.$(commentBoxSelector);
      
      if (commentBox) {
        console.log(`Commenting on post ${postIndex}...`);
        const prompt = `Craft a thoughtful, engaging, and mature reply to the following post: "${caption}". 

CRITICAL LANGUAGE RULES:
- If the post is in Italian, RESPOND IN ITALIAN
- If the post is in English, RESPOND IN ENGLISH  
- If the post is in another language, RESPOND IN ENGLISH
- Detect the language automatically from the post content

Ensure the reply is relevant, insightful, and adds value to the conversation. 
It should reflect empathy and professionalism, and avoid sounding too casual or superficial. 
Also it should be 300 characters or less and should not go against Instagram Community Standards on spam. 
Try your best to humanize the reply;`;
        
        const schema = getInstagramCommentSchema();
        const result = await runAgent(schema, prompt);
        const comment = result[0]?.comment;

        // Type the comment
        await commentBox.click();
        await delay(CONFIG.DELAYS.AFTER_COMMENT_CLICK);
        await commentBox.type(comment);
        await delay(CONFIG.DELAYS.AFTER_COMMENT_TYPE);

        // Try to submit the comment using page evaluation
        const submitResult = await page.evaluate((selector: string) => {
          const post = document.querySelector(selector);
          if (!post) return { success: false, reason: "Post not found" };

          // Look for Post button using XPath-like approach
          const walker = document.createTreeWalker(
            post,
            NodeFilter.SHOW_TEXT,
            null
          );

          let node;
          let postButton = null;

          while (node = walker.nextNode()) {
            if (node.textContent && (node.textContent.trim() === 'Post' || node.textContent.trim() === 'Pubblica')) {
              // Found text node, get the parent button
              let parent = node.parentElement;
              while (parent && parent !== post) {
                if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button') {
                  if (!parent.getAttribute('disabled') && !parent.getAttribute('aria-disabled')) {
                    postButton = parent;
                    break;
                  }
                }
                parent = parent.parentElement;
              }
              if (postButton) break;
            }
          }

          if (postButton) {
            (postButton as HTMLElement).click();
            return { success: true, reason: "Post button clicked" };
          } else {
            return { success: false, reason: "Post button not found" };
          }
        }, postSelector);

        if (submitResult.success) {
          console.log(`Comment posted on post ${postIndex} successfully.`);
          await delay(CONFIG.DELAYS.AFTER_COMMENT_POST);
        } else {
          console.log(`Post button not found, trying keyboard shortcuts...`);
          
          // Focus and try Enter
          await page.focus(commentBoxSelector);
          await delay(CONFIG.DELAYS.KEYBOARD_DELAY);
          await page.keyboard.press("Enter");
          await delay(CONFIG.DELAYS.AFTER_COMMENT_TYPE);
          
          // Check if comment was posted by seeing if textarea is empty
          const isPosted = await page.evaluate((selector: string) => {
            const textarea = document.querySelector(selector) as HTMLTextAreaElement;
            return textarea && textarea.value.trim() === '';
          }, commentBoxSelector);
          
          if (isPosted) {
            console.log(`Comment posted on post ${postIndex} via Enter.`);
          } else {
            console.log(`Comment posting failed for post ${postIndex}.`);
          }
        }
      } else {
        console.log("Comment box not found.");
      }

      const waitTime = getRandomDelay(CONFIG.DELAYS.BETWEEN_POSTS.MIN, CONFIG.DELAYS.BETWEEN_POSTS.MAX);
      console.log(`⏰ Waiting ${Math.round(waitTime / 60000)} minutes before moving to the next post... (Current time: ${new Date().toLocaleTimeString()})`);
      await delay(waitTime);

      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });

      postIndex++;
    } catch (error) {
      console.error(`Error interacting with post ${postIndex}:`, error);
      break;
    }
  }
}

export { runInstagram };
