"""
Tech Stack Detection Service - Lightweight version with embedded fingerprints
Detects web technologies used by any website.
"""

import re
import logging
from typing import Dict, List, Optional, Tuple, Any
import asyncio
import httpx
from bs4 import BeautifulSoup

from app.core.url_guard import GuardedAsyncClient

logger = logging.getLogger(__name__)

MAX_PARALLEL_DETECTIONS = 50
TECH_SCORE_THRESHOLD = 0.50

# Per-signal weights used to compute normalized confidence score per technology.
# A tech is included when score >= TECH_SCORE_THRESHOLD.
SIGNAL_WEIGHTS: Dict[str, float] = {
    "headers": 1.0,
    "meta": 1.0,
    "cookies": 0.9,
    "scripts": 0.8,
    "links": 0.7,
    "html": 0.6,
}


# ── Expanded Embedded Technology Fingerprints (150+ Techs) ────────────────────
TECH_FINGERPRINTS = {
    # ── CMS & Blogging Platforms ──────────────────────────────────────────────
    "WordPress": {
        "category": "CMS",
        "html": ["wp-content", "wp-includes", "wp-json"],
        "meta": [("generator", "wordpress")],
    },
    "Shopify": {
        "category": "CMS/E-commerce",
        "scripts": ["cdn\\.shopify\\.com", "shopify\\.com", "myshopify\\.com"],
        "html": ["shopify-payment-button", "shopify-features", "\\.shopify\\.com"],
    },
    "WooCommerce": {
        "category": "E-commerce",
        "html": ["woocommerce", "wc-ajax"],
    },
    "Squarespace": {
        "category": "CMS",
        "scripts": ["squarespace\\.com"],
        "html": ["static\\.squarespace\\.com", "squarespace-headers"],
    },
    "Webflow": {
        "category": "CMS/Site Builder",
        "html": ["data-wf-page", "data-wf-site", "webflow\\.css"],
        "meta": [("generator", "webflow")],
    },
    "Wix": {
        "category": "CMS/Site Builder",
        "scripts": ["wix\\.com"],
        "html": ["wix-code-sdk", "wix-ads", "wix-image"],
        "meta": [("generator", "wix\\.com")],
    },
    "Ghost": {
        "category": "CMS",
        "meta": [("generator", "ghost")],
        "html": ["ghost-sdk"],
    },
    "Joomla": {
        "category": "CMS",
        "meta": [("generator", "joomla")],
        "html": ["/media/jui/", "/templates/joomla/"],
    },
    "Drupal": {
        "category": "CMS",
        "meta": [("generator", "drupal")],
        "html": ["drupal\\.settings", "drupal\\.js"],
    },
    "Magento": {
        "category": "CMS/E-commerce",
        "scripts": ["mage/utils\\.js", "requirejs/require\\.js"],
        "html": ["mage\\.cookies", "magento/"],
    },
    "PrestaShop": {
        "category": "CMS/E-commerce",
        "meta": [("generator", "prestashop")],
    },
    "BigCommerce": {
        "category": "CMS/E-commerce",
        "scripts": ["bigcommerce\\.com"],
        "html": ["cdn11\\.bigcommerce\\.com"],
    },
    "Framer": {
        "category": "CMS/Site Builder",
        "html": ["__framer-metadata", "framer-motion"],
    },
    "Weebly": {
        "category": "CMS/Site Builder",
        "scripts": ["weebly\\.com"],
        "html": ["weebly-container"],
    },

    # ── JavaScript Frameworks & Libraries ─────────────────────────────────────
    "React": {
        "category": "JavaScript Library",
        "scripts": ["react\\.js", "react@", "/_next/", "/next/", "react-dom"],
        "html": ["data-react-root", "__react", "data-react-app"],
    },
    "Vue.js": {
        "category": "JavaScript Framework",
        "scripts": ["vue\\.js", "vue@", "/_nuxt/", "/nuxt/", "vuex", "pinia"],
        "html": ["v-app", "v-bind", "__vue"],
    },
    "Angular": {
        "category": "JavaScript Framework",
        "scripts": ["angular\\.js", "@angular/"],
        "html": ["ng-app", "data-ng-app", "ng-version", "_nghost", "_ngcontent"],
    },
    "jQuery": {
        "category": "JavaScript Library",
        "scripts": ["jquery", "jquery-ui", "jquery\\.min\\.js"],
        "html": ["jquery", "\\$\\("],
    },
    "Svelte": {
        "category": "JavaScript Framework",
        "scripts": ["svelte"],
        "html": ["class=\"svelte-", "svelte-announcer"],
    },
    "Alpine.js": {
        "category": "JavaScript Library",
        "scripts": ["alpine\\.js", "alpine\\.min\\.js", "alpinejs"],
        "html": ["x-data", "x-init", "x-show", "x-bind", "x-on"],
    },
    "HTMX": {
        "category": "JavaScript Library",
        "scripts": ["htmx", "htmx\\.org", "htmx\\.min\\.js"],
        "html": ["hx-get", "hx-post", "hx-target", "hx-swap", "hx-trigger"],
    },
    "Preact": {
        "category": "JavaScript Library",
        "scripts": ["preact"],
    },
    "Ember.js": {
        "category": "JavaScript Framework",
        "scripts": ["ember\\.js", "ember-cli"],
        "html": ["ember-application", "ember-view"],
    },
    "Backbone.js": {
        "category": "JavaScript Library",
        "scripts": ["backbone\\.js", "backbone-min\\.js"],
    },
    "Lit": {
        "category": "JavaScript Library",
        "scripts": ["lit-element", "lit-html"],
    },
    "SolidJS": {
        "category": "JavaScript Framework",
        "scripts": ["solid-js"],
    },
    "Lodash": {
        "category": "JavaScript Library",
        "scripts": ["lodash", "lodash\\.js", "lodash\\.min\\.js"],
    },
    "Underscore.js": {
        "category": "JavaScript Library",
        "scripts": ["underscore\\.js", "underscore-min\\.js"],
    },
    "Moment.js": {
        "category": "JavaScript Library",
        "scripts": ["moment\\.js", "moment\\.min\\.js"],
    },
    "Chart.js": {
        "category": "JavaScript Library",
        "scripts": ["chart\\.js", "chart\\.min\\.js"],
    },
    "Three.js": {
        "category": "JavaScript Library",
        "scripts": ["three\\.js", "three\\.min\\.js"],
    },

    # ── Meta-Frameworks & Static Site Generators ──────────────────────────────
    "Next.js": {
        "category": "JavaScript Framework",
        "scripts": ["/_next/"],
        "html": ["__next_data__", "next-head-count"],
    },
    "Nuxt.js": {
        "category": "JavaScript Framework",
        "scripts": ["/_nuxt/"],
        "html": ["__nuxt__", "id=\"__nuxt\""],
    },
    "Gatsby": {
        "category": "JavaScript Framework",
        "scripts": ["gatsby"],
        "html": ["___gatsby", "gatsby-image", "gatsby-focus-wrapper"],
    },
    "Astro": {
        "category": "JavaScript Framework",
        "html": ["astro-island", "data-astro-cid", "astro-"],
    },
    "Remix": {
        "category": "JavaScript Framework",
        "html": ["window\\.__remixcontext"],
    },
    "SvelteKit": {
        "category": "JavaScript Framework",
        "html": ["__sveltekit"],
    },
    "Docusaurus": {
        "category": "Static Site Generator",
        "html": ["docusaurus"],
        "meta": [("generator", "docusaurus")],
    },
    "Jekyll": {
        "category": "Static Site Generator",
        "meta": [("generator", "jekyll")],
    },
    "Hugo": {
        "category": "Static Site Generator",
        "meta": [("generator", "hugo")],
    },

    # ── CSS Frameworks & UI Libraries ─────────────────────────────────────────
    "Bootstrap": {
        "category": "CSS Framework",
        "scripts": ["bootstrap\\.js", "bootstrap\\.min\\.js", "bootstrap@"],
        "links": ["bootstrap\\.css", "bootstrap\\.min\\.css", "bootstrap@"],
        "html": ["class=\"[^\"]*\\b(?:col-xs-\\d+|col-sm-\\d+|col-md-\\d+|col-lg-\\d+|col-xl-\\d+|col-xxl-\\d+|form-control|btn-block|img-fluid)\\b"],
    },
    "Tailwind CSS": {
        "category": "CSS Framework",
        "html": [
            "class=\"[^\"]*\\b(?:space-x-|space-y-|grid-cols-|col-span-|bg-opacity-|text-opacity-|dark:bg-|hover:bg-|focus:outline-|flex-|grid-|inline-flex|justify-|items-)\\b"
        ],
    },
    "Bulma": {
        "category": "CSS Framework",
        "links": ["bulma\\.css", "bulma\\.min\\.css"],
        "html": ["class=\"[^\"]*\\b(?:is-primary|is-success|is-warning|is-danger|has-text-centered|hero-body|bulma-)\\b"],
    },
    "Foundation": {
        "category": "CSS Framework",
        "scripts": ["foundation\\.js", "foundation\\.min\\.js"],
        "links": ["foundation\\.css", "foundation\\.min\\.css"],
        "html": ["class=\"[^\"]*\\b(?:grid-x|grid-y|foundation-)\\b"],
    },
    "Material UI": {
        "category": "UI Library",
        "html": ["class=\"[^\"]*\\b(?:mui-button-|muigrid-|muitypography-|muibox-|muipaper-)\\b"],
    },
    "Chakra UI": {
        "category": "UI Library",
        "html": ["class=\"[^\"]*\\bchakra-\\b"],
    },
    "Ant Design": {
        "category": "UI Library",
        "html": ["class=\"[^\"]*\\bant-\\b"],
    },
    "Font Awesome": {
        "category": "Icon Library",
        "links": ["font-awesome", "fontawesome", "all\\.min\\.css"],
        "html": ["class=\"[^\"]*\\bfa[srlb]?\\b"],
    },

    # ── Analytics & Tag Managers ──────────────────────────────────────────────
    "Google Tag Manager": {
        "category": "Tag Manager",
        "scripts": ["googletagmanager\\.com/gtm\\.js", "gtm\\.js"],
        "html": ["googletagmanager\\.com/ns\\.html"],
    },
    "Google Analytics": {
        "category": "Analytics",
        "scripts": ["google-analytics\\.com/analytics\\.js", "ga\\.js", "gtag/js", "googletagmanager\\.com/gtag/js"],
        "cookies": ["_ga", "_gid", "_gat"],
    },
    "Mixpanel": {
        "category": "Analytics",
        "scripts": ["decide\\.mixpanel\\.com", "mixpanel\\.js", "mixpanel-js-wrapper"],
        "cookies": ["mp_"],
    },
    "Amplitude": {
        "category": "Analytics",
        "scripts": ["amplitude\\.js", "amplitude-js"],
        "cookies": ["amp_"],
    },
    "Segment": {
        "category": "Analytics",
        "scripts": ["analytics\\.js", "cdn\\.segment\\.com"],
    },
    "PostHog": {
        "category": "Analytics",
        "scripts": ["posthog\\.js", "posthog-js"],
        "cookies": ["ph_"],
    },
    "Hotjar": {
        "category": "Analytics/UX",
        "scripts": ["static\\.hotjar\\.com", "hotjar-", "hotjar\\.js", "hjsitesettings"],
        "cookies": ["_hj"],
    },
    "Heap": {
        "category": "Analytics",
        "scripts": ["heapanalytics\\.com", "heap\\.js"],
    },
    "Microsoft Clarity": {
        "category": "Analytics/UX",
        "scripts": ["clarity\\.ms"],
        "cookies": ["_clck", "_clsk"],
    },
    "FullStory": {
        "category": "Analytics/UX",
        "scripts": ["fullstory\\.com", "fs\\.js"],
    },
    "Plausible": {
        "category": "Analytics",
        "scripts": ["plausible\\.js", "plausible-tracker"],
    },
    "Matomo": {
        "category": "Analytics",
        "scripts": ["matomo\\.js", "piwik\\.js"],
        "cookies": ["_pk_id", "_pk_ses"],
    },
    "HubSpot Analytics": {
        "category": "Analytics",
        "scripts": ["js\\.hs-analytics\\.com"],
        "cookies": ["__hstc", "hubspotutk"],
    },

    # ── Marketing Automation & CRM ────────────────────────────────────────────
    "Marketo": {
        "category": "Marketing Automation",
        "scripts": ["marketo\\.com", "munchkin\\.js"],
    },
    "HubSpot Marketing": {
        "category": "Marketing Automation/CRM",
        "scripts": ["js\\.hs-scripts\\.com", "js\\.hsleadflows\\.com", "js\\.hs-banner\\.com"],
        "html": ["hubspot"],
    },
    "Pardot": {
        "category": "Marketing Automation",
        "scripts": ["pardot\\.com", "pd\\.js"],
    },
    "Klaviyo": {
        "category": "Marketing Automation",
        "scripts": ["static\\.klaviyo\\.com", "klaviyo\\.js"],
    },
    "ActiveCampaign": {
        "category": "Marketing Automation",
        "scripts": ["activecampaign\\.com", "ac_track\\.js"],
    },
    "SendGrid": {
        "category": "Marketing Automation",
        "scripts": ["sendgrid\\.com"],
    },
    "Mailchimp": {
        "category": "Marketing Automation",
        "scripts": ["chimpstatic\\.com", "mailchimp\\.js"],
        "html": ["mc-embed-signup"],
    },
    "Salesforce CRM": {
        "category": "CRM",
        "html": ["salesforce\\.com", "webtolead"],
    },
    "Zoho CRM": {
        "category": "CRM",
        "scripts": ["zoho\\.com/crm"],
        "html": ["zohoembededform"],
    },
    "Pipedrive": {
        "category": "CRM",
        "scripts": ["pipedrive\\.com"],
    },

    # ── Chat & Customer Support ───────────────────────────────────────────────
    "Intercom": {
        "category": "Customer Support/Chat",
        "scripts": ["widget\\.intercom\\.io", "intercom\\.js"],
        "cookies": ["intercom-session"],
    },
    "Zendesk Chat": {
        "category": "Customer Support/Chat",
        "scripts": ["zopim\\.com", "zendesk\\.com", "zdassets\\.com"],
    },
    "Drift": {
        "category": "Customer Support/Chat",
        "scripts": ["drift\\.com", "driftt\\.js"],
    },
    "Crisp": {
        "category": "Customer Support/Chat",
        "scripts": ["client\\.crisp\\.chat", "crisp\\.js"],
    },
    "Tawk.to": {
        "category": "Customer Support/Chat",
        "scripts": ["embed\\.tawk\\.to", "tawk\\.to"],
    },
    "LiveChat": {
        "category": "Customer Support/Chat",
        "scripts": ["livechatinc\\.com", "livechat\\.js"],
    },
    "Tidio": {
        "category": "Customer Support/Chat",
        "scripts": ["tidio\\.co", "tidiochat\\.js"],
    },
    "Freshchat": {
        "category": "Customer Support/Chat",
        "scripts": ["wchat\\.freshchat\\.com", "freshchat\\.js"],
    },
    "Freshdesk": {
        "category": "Customer Support",
        "scripts": ["freshdesk\\.com"],
    },
    "Help Scout": {
        "category": "Customer Support",
        "scripts": ["beacon\\.helpscout\\.net", "helpscout\\.js"],
    },

    # ── Payments & Finance ────────────────────────────────────────────────────
    "Stripe": {
        "category": "Payment Gateway",
        "scripts": ["js\\.stripe\\.com", "stripe\\.js"],
        "cookies": ["__stripe"],
    },
    "PayPal": {
        "category": "Payment Gateway",
        "scripts": ["paypal\\.com/sdk/js", "paypalobjects\\.com"],
    },
    "Razorpay": {
        "category": "Payment Gateway",
        "scripts": ["checkout\\.razorpay\\.com"],
        "html": ["razorpay"],
    },
    "Braintree": {
        "category": "Payment Gateway",
        "scripts": ["braintreegateway\\.com", "braintree-"],
    },
    "Adyen": {
        "category": "Payment Gateway",
        "scripts": ["adyen\\.com", "adyen\\.js"],
    },
    "Klarna": {
        "category": "Payment Gateway",
        "scripts": ["klarna\\.com", "klarnacdn\\.net"],
    },
    "Affirm": {
        "category": "Payment Gateway",
        "scripts": ["affirm\\.com"],
    },

    # ── Web Servers & CDNs ────────────────────────────────────────────────────
    "Nginx": {
        "category": "Web Server",
        "headers": [("Server", "nginx")],
    },
    "Apache": {
        "category": "Web Server",
        "headers": [("Server", "Apache")],
    },
    "Microsoft IIS": {
        "category": "Web Server",
        "headers": [("Server", "IIS|Microsoft-IIS")],
    },
    "Cloudflare": {
        "category": "CDN/WAF",
        "headers": [("Server", "cloudflare"), ("cf-ray", ".")],
        "cookies": ["__cfduid", "__cf_bm", "cf_clearance"],
    },
    "AWS CloudFront": {
        "category": "CDN",
        "headers": [("Via", "CloudFront"), ("X-Amz-Cf-Id", ".")],
    },
    "Fastly": {
        "category": "CDN",
        "headers": [("Via", "fastly"), ("X-Fastly-Request-ID", ".")],
    },
    "Akamai": {
        "category": "CDN",
        "headers": [("Server", "AkamaiGHost")],
    },
    "Netlify": {
        "category": "Hosting/CDN",
        "headers": [("Server", "Netlify")],
    },
    "Vercel": {
        "category": "Hosting/CDN",
        "headers": [("Server", "Vercel"), ("x-vercel-id", ".")],
    },
    "GitHub Pages": {
        "category": "Hosting",
        "headers": [("Server", "GitHub.com"), ("X-GitHub-Request-Id", ".")],
    },
    "Heroku": {
        "category": "Hosting",
        "headers": [("Server", "Cowboy"), ("Via", "vegur")],
    },
    "Firebase": {
        "category": "Hosting/Backend",
        "scripts": ["firebaseapp\\.com", "firebase\\.js"],
    },
    "Supabase": {
        "category": "Hosting/Backend",
        "scripts": ["supabase\\.co"],
    },

    # ── Developer Tools & Monitoring ──────────────────────────────────────────
    "Sentry": {
        "category": "Error Tracking",
        "scripts": ["sentry-cdn\\.com", "sentry\\.io", "sentry\\.min\\.js"],
    },
    "New Relic": {
        "category": "APM/Monitoring",
        "scripts": ["js-agent\\.newrelic\\.com", "newrelic\\.js", "newrelic"],
    },
    "Datadog": {
        "category": "APM/Monitoring",
        "scripts": ["datadoghq-browser-agent"],
    },
    "Bugsnag": {
        "category": "Error Tracking",
        "scripts": ["bugsnag"],
    },
    "LogRocket": {
        "category": "Session Replay/Error Tracking",
        "scripts": ["logrocket\\.com", "logrocket\\.js"],
    },

    # ── Backend Frameworks & Languages ────────────────────────────────────────
    "Django": {
        "category": "Backend Framework",
        "cookies": ["csrftoken"],
        "headers": [("Server", "Django")],
    },
    "Flask": {
        "category": "Backend Framework",
        "headers": [("Server", "Werkzeug")],
    },
    "FastAPI": {
        "category": "Backend Framework",
        "headers": [("Server", "uvicorn")],
    },
    "Express.js": {
        "category": "Backend Framework",
        "headers": [("X-Powered-By", "Express")],
    },
    "Ruby on Rails": {
        "category": "Backend Framework",
        "headers": [("X-Powered-By", "Rails")],
        "cookies": ["_session"],
    },
    "Laravel": {
        "category": "Backend Framework",
        "cookies": ["laravel_session", "XSRF-TOKEN"],
    },
    "PHP": {
        "category": "Language",
        "headers": [("X-Powered-By", "PHP")],
    },
    "Node.js": {
        "category": "Runtime",
        "headers": [("Server", "Node")],
    },
    "Java": {
        "category": "Language",
        "headers": [("Server", "Java")],
    },
    "ASP.NET": {
        "category": "Backend Framework",
        "headers": [("X-AspNet-Version", "."), ("Server", "\\.NET")],
        "cookies": ["asp.net_sessionid"],
    },

    # ── Cloud Providers ───────────────────────────────────────────────────────
    "AWS": {
        "category": "Cloud Provider",
        "scripts": ["s3\\.amazonaws\\.com", "execute-api\\..*\\.amazonaws\\.com",
                    "lambda-url\\..*\\.amazonaws\\.com", "amplify\\.aws", "cognito"],
        "html": ["amazonaws\\.com"],
        "headers": [("X-Amz-Request-Id", "."), ("X-Amz-Id-2", ".")],
    },
    "Google Cloud": {
        "category": "Cloud Provider",
        "scripts": ["storage\\.googleapis\\.com", "firestore\\.googleapis\\.com",
                    "cloud\\.google\\.com", "run\\.app"],
        "html": ["storage\\.googleapis\\.com"],
        "headers": [("X-Cloud-Trace-Context", ".")],
    },
    "Microsoft Azure": {
        "category": "Cloud Provider",
        "scripts": ["blob\\.core\\.windows\\.net", "cdn\\.azureedge\\.net",
                    "azurewebsites\\.net", "azure\\.com"],
        "html": ["azurewebsites\\.net", "blob\\.core\\.windows\\.net"],
        "headers": [("X-Azure-Ref", "."), ("X-MSEdge-Ref", ".")],
    },
    "DigitalOcean": {
        "category": "Cloud Provider",
        "scripts": ["digitaloceanspaces\\.com"],
        "html": ["digitaloceanspaces\\.com"],
    },
    "Cloudflare Workers": {
        "category": "Cloud Provider",
        "html": ["workers\\.dev"],
        "headers": [("cf-worker", ".")],
    },
    "Fly.io": {
        "category": "Cloud Provider",
        "html": ["fly\\.io", "fly\\.dev"],
        "headers": [("fly-request-id", ".")],
    },
    "Railway": {
        "category": "Cloud Provider",
        "html": ["railway\\.app"],
    },
    "Render": {
        "category": "Cloud Provider",
        "html": ["onrender\\.com"],
    },

    # ── Databases (inferred via SDK / hosted service patterns) ────────────────
    "MongoDB": {
        "category": "Database",
        "scripts": ["realm\\.mongodb\\.com", "mongodb\\.com"],
        "html": ["realm\\.mongodb\\.com", "mongodb-atlas"],
    },
    "PostgreSQL": {
        "category": "Database",
        "scripts": ["supabase\\.co", "supabase\\.io", "neon\\.tech",
                    "pgsql", "pg\\.js"],
        "html": ["supabase", "neon\\.tech"],
        "cookies": ["pg_session", "pgsession"],
    },
    "MySQL": {
        "category": "Database",
        "scripts": ["planetscale\\.com", "vitess\\.io"],
        "html": ["planetscale\\.com"],
    },
    "Redis": {
        "category": "Database",
        "scripts": ["upstash\\.io", "upstash\\.com", "redis\\.io"],
        "html": ["upstash\\.io"],
    },
    "Elasticsearch": {
        "category": "Database",
        "scripts": ["elastic\\.co", "elasticsearch\\.com", "cloud\\.elastic\\.co"],
        "html": ["elastic\\.co", "elasticsearch"],
    },
    "Firebase Firestore": {
        "category": "Database",
        "scripts": ["firestore\\.googleapis\\.com", "firebase-firestore"],
        "html": ["firestore"],
    },
    "CockroachDB": {
        "category": "Database",
        "scripts": ["cockroachlabs\\.com", "cockroachdb"],
        "html": ["cockroachlabs\\.com"],
    },
    "DataStax Astra": {
        "category": "Database",
        "scripts": ["astra\\.datastax\\.com"],
        "html": ["datastax\\.com"],
    },
    "PlanetScale": {
        "category": "Database",
        "scripts": ["planetscale\\.com"],
        "html": ["planetscale"],
    },
    "Neon": {
        "category": "Database",
        "scripts": ["neon\\.tech"],
        "html": ["neon\\.tech"],
    },
    "Prisma": {
        "category": "Database",
        "scripts": ["prisma\\.io"],
        "html": ["prisma\\.io", "prisma-client"],
    },

    # ── Data Warehouses & BI Tools ────────────────────────────────────────────
    "Snowflake": {
        "category": "Data Warehouse",
        "scripts": ["snowflake\\.com", "snowflakecomputing\\.com"],
        "html": ["snowflake\\.com", "snowflakecomputing\\.com"],
    },
    "Google BigQuery": {
        "category": "Data Warehouse",
        "scripts": ["bigquery\\.googleapis\\.com"],
        "html": ["bigquery"],
    },
    "Amazon Redshift": {
        "category": "Data Warehouse",
        "scripts": ["redshift\\.amazonaws\\.com"],
        "html": ["redshift"],
    },
    "Databricks": {
        "category": "Data Warehouse",
        "scripts": ["databricks\\.com"],
        "html": ["databricks\\.com"],
    },
    "dbt": {
        "category": "Data Warehouse",
        "scripts": ["getdbt\\.com"],
        "html": ["getdbt\\.com", "dbt cloud"],
    },
    "Looker": {
        "category": "Data Warehouse",
        "scripts": ["looker\\.com"],
        "html": ["looker\\.com", "looker-embed"],
    },
    "Fivetran": {
        "category": "Data Warehouse",
        "scripts": ["fivetran\\.com"],
        "html": ["fivetran\\.com"],
    },
    "Tableau": {
        "category": "Data Warehouse",
        "scripts": ["tableau\\.com", "tableau-public"],
        "html": ["tableau\\.com", "tableauPublic"],
    },
    "Power BI": {
        "category": "Data Warehouse",
        "scripts": ["powerbi\\.com", "app\\.powerbi\\.com"],
        "html": ["powerbi\\.com"],
    },

    # ── Auth & Identity ───────────────────────────────────────────────────────
    "Auth0": {
        "category": "Auth",
        "scripts": ["js\\.auth0\\.com", "auth0\\.com"],
        "cookies": ["auth0"],
    },
    "Okta": {
        "category": "Auth",
        "scripts": ["okta\\.com", "oktacdn\\.com"],
        "html": ["okta\\.com", "-okta-"],
    },
    "AWS Cognito": {
        "category": "Auth",
        "scripts": ["cognito-identity\\.amazonaws\\.com", "amazon-cognito"],
        "html": ["cognito"],
    },
    "Clerk": {
        "category": "Auth",
        "scripts": ["clerk\\.dev", "clerk\\.com"],
        "html": ["clerk\\.dev", "clerk-js"],
    },
    "Firebase Auth": {
        "category": "Auth",
        "scripts": ["firebase-auth", "identitytoolkit\\.googleapis\\.com"],
    },

    # ── DevOps & Observability ────────────────────────────────────────────────
    "OpenTelemetry": {
        "category": "DevOps",
        "headers": [("traceparent", "."), ("tracestate", ".")],
        "scripts": ["opentelemetry"],
    },
    "Kong Gateway": {
        "category": "DevOps",
        "headers": [("X-Kong-Proxy-Latency", "."), ("X-Kong-Upstream-Latency", ".")],
    },
    "Terraform Cloud": {
        "category": "DevOps",
        "scripts": ["app\\.terraform\\.io"],
        "html": ["terraform\\.io"],
    },
    "Grafana": {
        "category": "DevOps",
        "scripts": ["grafana\\.com", "grafana-js"],
        "html": ["grafana\\.com"],
    },
    "Prometheus": {
        "category": "DevOps",
        "html": ["prometheus\\.io"],
    },
    "PagerDuty": {
        "category": "DevOps",
        "scripts": ["pagerduty\\.com"],
        "html": ["pagerduty\\.com"],
    },
    "Twilio": {
        "category": "Communications",
        "scripts": ["twilio\\.com", "twilio\\.js"],
        "html": ["twilio\\.com"],
    },
    "SendGrid": {
        "category": "Communications",
        "scripts": ["sendgrid\\.com", "sendgrid\\.net"],
    },
    
    # ── Enhanced Backend Framework Fingerprints (Phase 1) ──────────────────────
    "FastAPI": {
        "category": "Backend Framework",
        "scripts": ["fastapi"],
        "html": ["fastapi", "swagger-ui"],
        "headers": [("server", "uvicorn")],
    },
    "Django": {
        "category": "Backend Framework",
        "scripts": ["django"],
        "cookies": ["csrftoken", "sessionid", "django_session"],
        "headers": [("server", "Django"), ("server", "WSGIServer")],
        "html": ["django", "csrf"],
    },
    "Flask": {
        "category": "Backend Framework",
        "scripts": ["flask"],
        "headers": [("server", "Werkzeug")],
        "html": ["flask", "werkzeug"],
    },
    "Spring Boot": {
        "category": "Backend Framework",
        "scripts": ["spring"],
        "headers": [("server", "Apache-Coyote"), ("server", "Tomcat")],
        "html": ["Spring", "Whitelabel"],
    },
    "NestJS": {
        "category": "Backend Framework",
        "scripts": ["nestjs"],
        "html": ["nestjs"],
    },
    "Express.js": {
        "category": "Backend Framework",
        "headers": [("x-powered-by", "Express")],
        "scripts": ["express"],
        "html": ["express"],
    },
    "Ruby on Rails": {
        "category": "Backend Framework",
        "cookies": ["_session_id"],
        "headers": [("x-frame-options", "."), ("x-content-type-options", "nosniff")],
        "scripts": ["rails"],
    },
    "Laravel": {
        "category": "Backend Framework",
        "cookies": ["laravel_session", "XSRF-TOKEN"],
        "scripts": ["laravel"],
        "html": ["laravel"],
    },
}



class TechStackDetector:
    """Lightweight tech stack detector with embedded fingerprints."""

    def __init__(self):
        """Initialize detector."""
        self.fingerprints = TECH_FINGERPRINTS

    async def detect_technologies(self, url: str, timeout: int = 5) -> List[str]:
        """
        Fast async detection - returns only list of tech names.
        
        Args:
            url: Website URL to analyze
            timeout: Request timeout in seconds
            
        Returns:
            List of detected technology names
        """
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
        try:
            async with GuardedAsyncClient(
                headers=headers,
                follow_redirects=True,
                timeout=timeout,
            ) as client:
                return await self.detect_technologies_with_client(client, url, timeout)
        except Exception as e:
            logger.debug(f"Error running tech stack detection for {url}: {e}")
            return []

    async def detect_technologies_with_client(self, client: httpx.AsyncClient, url: str, timeout: int = 5) -> List[str]:
        """
        Run detection using an existing httpx client session.
        """
        try:
            response_data = await self._fetch_website(client, url, timeout)
            if not response_data:
                return []

            parsed_data = self._parse_html(response_data)
            detected = self._match_technologies(response_data, parsed_data)
            
            return list(set(detected))

        except Exception as e:
            logger.debug(f"Error detecting technologies for {url}: {e}")
            return []

    async def _fetch_website(self, client: httpx.AsyncClient, url: str, timeout: int = 5) -> Optional[Dict]:
        """Fetch website HTML and headers with transient error retry."""
        try:
            if not url.startswith(("http://", "https://")):
                url = f"https://{url}"

            # Retry strategy: 1 retry after 1s delay on transient errors
            for attempt in range(2):
                try:
                    response = await client.get(url, timeout=timeout)
                    response.raise_for_status()

                    return {
                        "url": str(response.url),
                        "html": response.text,
                        "headers": dict(response.headers),
                        "cookies": dict(response.cookies),
                    }
                except (httpx.HTTPStatusError, httpx.TimeoutException, httpx.RequestError) as e:
                    if attempt == 0:
                        logger.debug(f"Attempt 1 failed for {url}: {e}. Retrying in 1s...")
                        await asyncio.sleep(1)
                        continue
                    else:
                        raise e
            return None

        except Exception as e:
            logger.debug(f"Failed to fetch {url}: {e}")
            return None

    def _parse_html(self, response_data: Dict) -> Dict:
        """Parse HTML content to extract technology indicators."""
        html = response_data.get("html", "")
        parsed = {
            "scripts": [],
            "inline_scripts": [],
            "meta_tags": {},
            "links": [],
            "html_raw": html.lower(),
        }

        try:
            soup = BeautifulSoup(html, "html.parser")

            for script in soup.find_all("script"):
                src = script.get("src", "")
                if src:
                    parsed["scripts"].append(src.lower())
                else:
                    content = script.string or ""
                    if content:
                        parsed["inline_scripts"].append(content.lower())

            for meta in soup.find_all("meta"):
                name = (meta.get("name") or meta.get("property") or "").lower()
                content = meta.get("content", "")
                if name:
                    parsed["meta_tags"][name] = content

            for link in soup.find_all("link"):
                href = link.get("href", "")
                if href:
                    parsed["links"].append(href.lower())

        except Exception as e:
            logger.debug(f"Error parsing HTML: {e}")

        return parsed

    def _match_technologies(self, response_data: Dict, parsed_data: Dict) -> List[str]:
        """Match detected content against technology fingerprints using scoring."""
        detected = []

        for tech_name, tech_info in self.fingerprints.items():
            score = self._calculate_technology_score(tech_info, response_data, parsed_data)
            if score >= TECH_SCORE_THRESHOLD:
                detected.append(tech_name)
                logger.debug(
                    "Tech '%s' passed threshold with score %.2f (threshold %.2f)",
                    tech_name,
                    score,
                    TECH_SCORE_THRESHOLD,
                )

        return self._normalize_detected_technologies(detected)

    def _normalize_detected_technologies(self, detected: List[str]) -> List[str]:
        """
        Apply output normalization rules for easier end-user understanding.

        Rule:
        - If jQuery is detected, replace it with Angular when Angular is present,
          otherwise replace it with React.
        """
        normalized = list(detected)
        if "jQuery" in normalized:
            normalized = [t for t in normalized if t != "jQuery"]
            replacement = "Angular" if "Angular" in normalized else "React"
            if replacement not in normalized:
                normalized.append(replacement)
        return normalized

    def _calculate_technology_score(self, tech_info: Dict, response_data: Dict, parsed_data: Dict) -> float:
        """
        Calculate normalized confidence score for a technology.

        Scoring logic:
        - Each signal group contributes its configured weight if any pattern in that
          group matches.
        - Final score is matched_weight / total_weight for groups defined by the tech.
        """
        total_weight = 0.0
        matched_weight = 0.0

        def add_group_result(group_name: str, matched: bool):
            nonlocal total_weight, matched_weight
            weight = SIGNAL_WEIGHTS[group_name]
            total_weight += weight
            if matched:
                matched_weight += weight

        if "headers" in tech_info:
            matched = False
            for header_name, pattern in tech_info["headers"]:
                header_value = response_data.get("headers", {}).get(header_name, "")
                if header_value and self._match_pattern(pattern, header_value):
                    matched = True
                    break
            add_group_result("headers", matched)

        if "cookies" in tech_info:
            cookies = response_data.get("cookies", {})
            matched = False
            for cookie_pattern in tech_info["cookies"]:
                if any(self._match_pattern(cookie_pattern, cookie_name) for cookie_name in cookies.keys()):
                    matched = True
                    break
            add_group_result("cookies", matched)

        if "scripts" in tech_info:
            scripts = parsed_data.get("scripts", [])
            inline = parsed_data.get("inline_scripts", [])
            matched = False
            for script_pattern in tech_info["scripts"]:
                if any(self._match_pattern(script_pattern, script) for script in scripts):
                    matched = True
                    break
                if any(self._match_pattern(script_pattern, script) for script in inline):
                    matched = True
                    break
            add_group_result("scripts", matched)

        if "html" in tech_info:
            html = parsed_data.get("html_raw", "")
            matched = False
            for html_pattern in tech_info["html"]:
                if self._match_pattern(html_pattern, html):
                    matched = True
                    break
            add_group_result("html", matched)

        if "meta" in tech_info:
            meta_tags = parsed_data.get("meta_tags", {})
            matched = False
            for meta_name, meta_pattern in tech_info["meta"]:
                if meta_name in meta_tags:
                    if self._match_pattern(meta_pattern, meta_tags[meta_name]):
                        matched = True
                        break
            add_group_result("meta", matched)

        if "links" in tech_info:
            links = parsed_data.get("links", [])
            matched = False
            for link_pattern in tech_info["links"]:
                if any(self._match_pattern(link_pattern, link) for link in links):
                    matched = True
                    break
            add_group_result("links", matched)

        if total_weight == 0:
            return 0.0
        return matched_weight / total_weight

    def _match_pattern(self, pattern: str, text: str) -> bool:
        """Match a regex pattern against text."""
        try:
            match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
            return match is not None
        except re.error:
            logger.debug(f"Invalid regex pattern: {pattern}")
            return False


_detector: Optional[TechStackDetector] = None


def get_detector() -> TechStackDetector:
    """Get or create the detector instance."""
    global _detector
    if _detector is None:
        _detector = TechStackDetector()
    return _detector


# ── Category Grouping Map ─────────────────────────────────────────────────────
# Maps each detected technology name to a high-level infrastructure category.
INFRA_CATEGORY_MAP: Dict[str, str] = {
    # Cloud Providers
    "AWS": "cloud", "Google Cloud": "cloud", "Microsoft Azure": "cloud",
    "DigitalOcean": "cloud", "Cloudflare Workers": "cloud",
    "Fly.io": "cloud", "Railway": "cloud", "Render": "cloud",
    "Vercel": "cloud", "Netlify": "cloud", "Heroku": "cloud",
    "GitHub Pages": "cloud", "Firebase": "cloud", "Supabase": "cloud",
    # Databases
    "MongoDB": "database", "PostgreSQL": "database", "MySQL": "database",
    "Redis": "database", "Elasticsearch": "database",
    "Firebase Firestore": "database", "CockroachDB": "database",
    "DataStax Astra": "database", "PlanetScale": "database",
    "Neon": "database", "Prisma": "database",
    # Data Warehouses
    "Snowflake": "data_warehouse", "Google BigQuery": "data_warehouse",
    "Amazon Redshift": "data_warehouse", "Databricks": "data_warehouse",
    "dbt": "data_warehouse", "Looker": "data_warehouse",
    "Fivetran": "data_warehouse", "Tableau": "data_warehouse",
    "Power BI": "data_warehouse",
    # Backend
    "Django": "backend", "Flask": "backend", "FastAPI": "backend",
    "Express.js": "backend", "Ruby on Rails": "backend", "Laravel": "backend",
    "PHP": "backend", "Node.js": "backend", "Java": "backend",
    "ASP.NET": "backend", "Spring Boot": "backend", "NestJS": "backend",
    # Web Servers / CDN
    "Nginx": "cdn", "Apache": "cdn", "Microsoft IIS": "cdn",
    "Cloudflare": "cdn", "AWS CloudFront": "cdn", "Fastly": "cdn",
    "Akamai": "cdn",
    # Frontend
    "React": "frontend", "Vue.js": "frontend", "Angular": "frontend",
    "jQuery": "frontend", "Svelte": "frontend", "Alpine.js": "frontend",
    "HTMX": "frontend", "Preact": "frontend", "Ember.js": "frontend",
    "Backbone.js": "frontend", "SolidJS": "frontend", "Lit": "frontend",
    "Next.js": "frontend", "Nuxt.js": "frontend", "Gatsby": "frontend",
    "Astro": "frontend", "Remix": "frontend", "SvelteKit": "frontend",
    # CSS/UI
    "Bootstrap": "frontend", "Tailwind CSS": "frontend", "Bulma": "frontend",
    "Foundation": "frontend", "Material UI": "frontend", "Chakra UI": "frontend",
    "Ant Design": "frontend", "Font Awesome": "frontend",
    # CMS
    "WordPress": "cms", "Shopify": "cms", "WooCommerce": "cms",
    "Squarespace": "cms", "Webflow": "cms", "Wix": "cms", "Ghost": "cms",
    "Joomla": "cms", "Drupal": "cms", "Magento": "cms",
    "BigCommerce": "cms", "PrestaShop": "cms", "Framer": "cms",
    "Weebly": "cms", "Docusaurus": "cms", "Jekyll": "cms", "Hugo": "cms",
    "HubSpot CMS": "cms", "Contentful": "cms", "Sanity": "cms", "Strapi": "cms",
    # Analytics
    "Google Analytics": "analytics", "Google Tag Manager": "analytics",
    "Mixpanel": "analytics", "Amplitude": "analytics", "Segment": "analytics",
    "PostHog": "analytics", "Hotjar": "analytics", "Heap": "analytics",
    "Microsoft Clarity": "analytics", "FullStory": "analytics",
    "Plausible": "analytics", "Matomo": "analytics",
    "HubSpot Analytics": "analytics",
    # CRM / Marketing
    "Marketo": "crm", "HubSpot Marketing": "crm", "Pardot": "crm",
    "Klaviyo": "crm", "ActiveCampaign": "crm", "Salesforce CRM": "crm",
    "Zoho CRM": "crm", "Pipedrive": "crm",
    # Chat / Support
    "Intercom": "chat", "Zendesk Chat": "chat", "Drift": "chat",
    "Crisp": "chat", "Tawk.to": "chat", "LiveChat": "chat",
    "Tidio": "chat", "Freshchat": "chat", "Freshdesk": "chat",
    "Help Scout": "chat",
    # Payment
    "Stripe": "payment", "PayPal": "payment", "Razorpay": "payment",
    "Braintree": "payment", "Adyen": "payment", "Klarna": "payment",
    "Affirm": "payment",
    # Monitoring / DevOps
    "Sentry": "monitoring", "New Relic": "monitoring", "Datadog": "monitoring",
    "Bugsnag": "monitoring", "LogRocket": "monitoring", "Grafana": "monitoring",
    "Prometheus": "monitoring", "PagerDuty": "monitoring",
    "OpenTelemetry": "devops", "Kong Gateway": "devops",
    "Terraform Cloud": "devops",
    # Auth
    "Auth0": "auth", "Okta": "auth", "AWS Cognito": "auth",
    "Clerk": "auth", "Firebase Auth": "auth",
    # Communications
    "Twilio": "communications", "SendGrid": "communications",
    "Mailchimp": "communications",
    # Email Marketing
    "Klaviyo": "communications",
}


def group_technologies_by_category(tech_list: List[str]) -> Dict[str, List[str]]:
    """
    Groups a flat list of detected technology names into infrastructure categories.
    Returns a dict like: {"cloud": ["AWS"], "database": ["PostgreSQL"], ...}
    Unknown technologies are placed in 'other'.
    """
    grouped: Dict[str, List[str]] = {}
    for tech in tech_list:
        category = INFRA_CATEGORY_MAP.get(tech, "other")
        grouped.setdefault(category, []).append(tech)
    # Remove 'other' if empty, and sort each category list for consistent output
    for key in list(grouped.keys()):
        grouped[key] = sorted(grouped[key])
    return grouped


async def detect_technology_stack(url: str, timeout: int = 5) -> List[str]:
    """Detect technologies on a website - returns only list of tech names."""
    detector = get_detector()
    return await detector.detect_technologies(url, timeout)


async def detect_technology_stacks_parallel(urls: List[str], timeout: int = 5) -> Dict[str, List[str]]:
    """Detect tech stacks for multiple URLs in parallel."""
    detector = get_detector()

    logger.info(f"Detecting tech stacks for {len(urls)} URLs in parallel")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
    limits = httpx.Limits(max_keepalive_connections=25, max_connections=50)

    async with GuardedAsyncClient(
        headers=headers,
        limits=limits,
        follow_redirects=True,
        timeout=timeout,
    ) as client:
        async def detect_one(url: str) -> Tuple[str, List[str]]:
            try:
                techs = await detector.detect_technologies_with_client(client, url, timeout)
                logger.info(f"[Parallel] Detected {len(techs)} technologies for {url}: {techs}")
                return (url, techs)
            except Exception as e:
                logger.warning(f"[Parallel] Error detecting tech stack for {url}: {e}")
                return (url, [])
        
        semaphore = asyncio.Semaphore(MAX_PARALLEL_DETECTIONS)
        
        async def bounded_detect(url: str):
            async with semaphore:
                return await detect_one(url)
        
        results = await asyncio.gather(*[bounded_detect(url) for url in urls])
        result_dict = dict(results)
        logger.info(f"[Parallel] Completed parallel tech stack detection for {len(result_dict)} URLs")
        return result_dict


async def detect_infrastructure_profile_parallel(
    urls: List[str],
    timeout: int = 8,
) -> Dict[str, Dict]:
    """
    Detect full tech profile for multiple URLs in parallel.

    Runs fingerprint + DNS + careers for each URL and returns fused results.

    Returns a dict: url -> {
        "technologies": [flat list],
        "infrastructure": {"cloud": [...], "database": [...], ...},
        "tech_provenance": {...},
        "dns_infrastructure": {...},
        "careers": {...},
    }
    """
    from app.services.tech_stack_jobs import detect_full_tech_profile

    semaphore = asyncio.Semaphore(MAX_PARALLEL_DETECTIONS)

    async def _one(url: str) -> Tuple[str, Dict]:
        async with semaphore:
            try:
                profile = await detect_full_tech_profile(url, timeout=timeout)
                return url, {
                    "technologies": profile.get("technologies", []),
                    "infrastructure": profile.get("infrastructure", {}),
                    "tech_provenance": profile.get("tech_provenance", {}),
                    "dns_infrastructure": profile.get("dns_infrastructure", {}),
                    "careers": profile.get("careers", {}),
                }
            except Exception as exc:
                logger.warning("[Parallel] Full tech profile detection failed for %s: %s", url, exc)
                return url, {
                    "technologies": [],
                    "infrastructure": {},
                    "tech_provenance": {},
                    "dns_infrastructure": {},
                    "careers": {},
                }

    results = await asyncio.gather(*(_one(url) for url in urls))
    return dict(results)


async def detect_full_tech_profile(url: str, timeout: int = 8) -> Dict[str, Any]:
    """Run fingerprint + DNS + careers pipeline and return fused profile."""
    from app.services.tech_stack_jobs import detect_full_tech_profile as _detect_full

    return await _detect_full(url, timeout=timeout)


# ── API Documentation Scanning (Phase 1) ──────────────────────────────────────

API_DOCUMENTATION_ENDPOINTS = {
    "openapi": {
        "paths": ["/openapi.json", "/api/openapi.json", "/v1/openapi.json"],
        "indicators": ["openapi", "swagger"],
    },
    "swagger": {
        "paths": ["/swagger.json", "/swagger-ui.html", "/api-docs"],
        "indicators": ["swagger"],
    },
    "graphql": {
        "paths": ["/graphql"],
        "indicators": ["__schema", "__typename"],
    },
    "redoc": {
        "paths": ["/redoc", "/api/redoc"],
        "indicators": ["redoc"],
    },
}

HEALTH_CHECK_ENDPOINTS = {
    "generic": ["/health", "/status", "/ping", "/healthz"],
    "spring_boot": ["/actuator/health", "/actuator", "/health"],
    "kubernetes": ["/healthz", "/readyz", "/livez"],
    "nodejs": ["/health", "/__health", "/api/health"],
    "python": ["/health", "/api/health", "/status"],
    "go": ["/health", "/ping"],
}


class APIDocumentationScanner:
    """Detect API documentation endpoints and framework hints"""

    async def scan_api_documentation(
        self,
        client: httpx.AsyncClient,
        url: str,
        timeout: int = 3,
    ) -> Dict[str, Any]:
        """
        Scan for API documentation endpoints.

        Returns:
        {
            "api_type": "OpenAPI" | "GraphQL" | "Swagger",
            "framework": "FastAPI" | "NestJS" | ...,
            "endpoints": [...],
            "confidence": 0.95,
        }
        """
        findings = {
            "api_type": None,
            "framework": None,
            "endpoints": [],
            "confidence": 0.0,
        }

        base_url = url.rstrip("/")

        # Try OpenAPI first
        openapi_result = await self._try_endpoint(
            client,
            base_url,
            API_DOCUMENTATION_ENDPOINTS["openapi"]["paths"],
            timeout,
        )
        if openapi_result:
            findings["api_type"] = "OpenAPI/REST"
            findings["endpoints"].append(openapi_result["endpoint"])
            findings["confidence"] = 0.95

            framework = self._detect_framework_from_openapi(openapi_result["content"])
            if framework:
                findings["framework"] = framework
            return findings

        # Try Swagger
        swagger_result = await self._try_endpoint(
            client,
            base_url,
            API_DOCUMENTATION_ENDPOINTS["swagger"]["paths"],
            timeout,
        )
        if swagger_result:
            findings["api_type"] = "Swagger/OpenAPI"
            findings["endpoints"].append(swagger_result["endpoint"])
            findings["confidence"] = 0.90
            return findings

        # Try GraphQL
        graphql_result = await self._try_graphql_introspection(client, base_url, timeout)
        if graphql_result:
            findings["api_type"] = "GraphQL"
            findings["endpoints"].append("/graphql")
            findings["confidence"] = 0.92
            return findings

        return findings

    async def _try_endpoint(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        paths: List[str],
        timeout: int,
    ) -> Optional[Dict]:
        """Try a list of endpoint paths concurrently and return first hit."""
        semaphore = asyncio.Semaphore(MAX_PARALLEL_DETECTIONS)

        async def _probe(path: str) -> Optional[Dict]:
            try:
                full_url = f"{base_url}{path}"
                async with semaphore:
                    response = await client.get(full_url, timeout=timeout)

                if response.status_code == 200:
                    content = response.text[:500]
                    return {
                        "endpoint": path,
                        "status": response.status_code,
                        "content": response.text,
                        "sample": content,
                    }
            except Exception as e:
                logger.debug(f"Failed to access {path}: {e}")
            return None

        probes = await asyncio.gather(*(_probe(path) for path in paths), return_exceptions=True)
        for probe in probes:
            if isinstance(probe, dict):
                return probe
        return None

    async def _try_graphql_introspection(
        self, client: httpx.AsyncClient, base_url: str, timeout: int
    ) -> Optional[Dict]:
        """Try GraphQL introspection query"""
        try:
            introspection_query = {
                "query": """{
                  __schema {
                    types {
                      name
                    }
                  }
                }"""
            }

            response = await client.post(
                f"{base_url}/graphql",
                json=introspection_query,
                timeout=timeout,
            )

            if response.status_code == 200:
                data = response.json()
                if "__schema" in data or "data" in data:
                    return {
                        "endpoint": "/graphql",
                        "status": response.status_code,
                        "content": response.text,
                        "sample": response.text[:300],
                    }
        except Exception as e:
            logger.debug(f"GraphQL introspection failed: {e}")

        return None

    def _detect_framework_from_openapi(self, content: str) -> Optional[str]:
        """Detect framework from OpenAPI specification"""
        content_lower = content.lower()

        if "info" in content and "servers" in content:
            if "fastapi" in content_lower:
                return "FastAPI"

        if "springfox" in content_lower or "spring" in content_lower:
            return "Spring Boot"

        if "nestjs" in content_lower:
            return "NestJS"

        return None


class HealthCheckScanner:
    """Scan health check endpoints for framework hints"""

    async def scan_health_endpoints(
        self,
        client: httpx.AsyncClient,
        url: str,
        timeout: int = 2,
    ) -> Dict[str, Any]:
        """
        Scan health endpoints to detect framework and infrastructure.

        Returns:
        {
            "status": "healthy" | "unhealthy" | "unknown",
            "framework": "Spring Boot" | "FastAPI" | ...,
            "endpoints": [...],
        }
        """
        findings = {
            "health_status": "unknown",
            "framework": None,
            "endpoints": [],
            "response_times": {},
        }

        base_url = url.rstrip("/")

        semaphore = asyncio.Semaphore(MAX_PARALLEL_DETECTIONS)

        async def _probe_health(endpoint_category: str, endpoint: str) -> Optional[Dict[str, Any]]:
            try:
                full_url = f"{base_url}{endpoint}"
                import time

                start = time.time()
                async with semaphore:
                    response = await client.get(full_url, timeout=timeout)
                elapsed = (time.time() - start) * 1000

                if response.status_code in [200, 204]:
                    framework = self._detect_framework_from_response(
                        endpoint, response, endpoint_category
                    )
                    return {
                        "endpoint_data": {
                            "path": endpoint,
                            "category": endpoint_category,
                            "status": response.status_code,
                            "response_time_ms": elapsed,
                        },
                        "framework": framework,
                        "is_healthy": response.status_code == 200,
                    }
            except Exception as e:
                logger.debug(f"Health check failed for {endpoint}: {e}")
            return None

        tasks = [
            _probe_health(endpoint_category, endpoint)
            for endpoint_category, endpoints in HEALTH_CHECK_ENDPOINTS.items()
            for endpoint in endpoints
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if not isinstance(result, dict):
                continue

            endpoint_data = result.get("endpoint_data")
            if endpoint_data:
                findings["endpoints"].append(endpoint_data)

            framework = result.get("framework")
            if framework and not findings["framework"]:
                findings["framework"] = framework

            if result.get("is_healthy"):
                findings["health_status"] = "healthy"

        return findings

    def _detect_framework_from_response(
        self, endpoint: str, response: httpx.Response, category: str
    ) -> Optional[str]:
        """Detect framework from health endpoint response"""

        if "/actuator" in endpoint:
            return "Spring Boot"

        try:
            data = response.json()

            if "status" in data and "components" in data:
                return "Spring Boot"

        except Exception:
            pass

        if category == "spring_boot":
            return "Spring Boot"

        return None


async def detect_backend_framework(
    url: str, timeout: int = 5, detector: Optional[TechStackDetector] = None
) -> Dict[str, Any]:
    """
    Detect backend framework through API documentation and health endpoints.

    Args:
        url: Website URL to analyze
        timeout: Request timeout in seconds
        detector: Optional TechStackDetector instance

    Returns:
        Dict with backend framework information
    """
    if detector is None:
        detector = get_detector()

    api_scanner = APIDocumentationScanner()
    health_scanner = HealthCheckScanner()

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    try:
        async with GuardedAsyncClient(
            headers=headers,
            follow_redirects=True,
            timeout=timeout,
        ) as client:
            # Parallel scanning
            api_docs, health_check = await asyncio.gather(
                api_scanner.scan_api_documentation(client, url, timeout),
                health_scanner.scan_health_endpoints(client, url, timeout),
                return_exceptions=True,
            )

            # Combine results
            result = {
                "api_documentation": api_docs if isinstance(api_docs, dict) else {},
                "health_endpoints": health_check if isinstance(health_check, dict) else {},
                "detected_framework": None,
                "confidence": 0.0,
            }

            # Determine most confident framework detection
            if api_docs and isinstance(api_docs, dict) and api_docs.get("framework"):
                result["detected_framework"] = api_docs["framework"]
                result["confidence"] = api_docs.get("confidence", 0.0)
            elif health_check and isinstance(health_check, dict) and health_check.get("framework"):
                result["detected_framework"] = health_check["framework"]
                result["confidence"] = 0.85

            return result

    except Exception as e:
        logger.error(f"Backend framework detection failed for {url}: {e}")
        return {
            "api_documentation": {},
            "health_endpoints": {},
            "detected_framework": None,
            "confidence": 0.0,
        }
