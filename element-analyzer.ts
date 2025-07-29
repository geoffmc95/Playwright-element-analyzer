// element-analyzer.ts
// Script to identify similar page elements across different pages for POM usage
//To run: npx ts-node element-analyzer.ts
//To change URLs, modify the 'urls' array in the main() function- 


import { chromium, Browser, Page, ElementHandle, Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Interface to define what constitutes an element's characteristics
interface ElementCharacteristics {
    tagName: string;
    classes: string[];
    attributes: Record<string, string>;
    textContent: string;
    role?: string;
    placeholder?: string;
    type?: string;
    href?: string;
    src?: string;
}

// Interface for storing element information with its location
interface ElementInfo {
    selector: string;
    characteristics: ElementCharacteristics;
    xpath: string;
    pageUrl: string;
}

// Interface for similarity results
interface SimilarityResult {
    element1: ElementInfo;
    element2: ElementInfo;
    similarityScore: number;
    matchingAttributes: string[];
}

// Interface for grouped similar elements (for POM usage)
interface GroupedElement {
    suggestedLocator: string;
    suggestedName: string;
    elementType: string;
    commonAttributes: string[];
    pages: string[];
    selectors: string[];
    confidence: number;
    pomRecommendation: string;
}

class ElementSimilarityAnalyzer {
    private browser: Browser | null = null;
    private pages: Page[] = [];

    constructor() {}

    // Initialize browser and create pages
    async initialize(): Promise<void> {
        this.browser = await chromium.launch({ headless: true });
        console.log('Browser initialized');
    }

    // Clean up resources
    async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed');
        }
    }

    // Navigate to a URL and return the page
    async navigateToPage(url: string): Promise<Page> {
        if (!this.browser) {
            throw new Error('Browser not initialized. Call initialize() first.');
        }

        const page = await this.browser.newPage();
        
        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            console.log(`Successfully navigated to: ${url}`);
            this.pages.push(page);
            return page;
        } catch (error) {
            console.error(`Failed to navigate to ${url}:`, error);
            await page.close();
            throw error;
        }
    }

    // Extract characteristics from an element
    async extractElementCharacteristics(element: ElementHandle, page: Page): Promise<ElementCharacteristics> {
        const characteristics = await element.evaluate((el: Element) => {
            // Get all attributes
            const attributes: Record<string, string> = {};
            for (const attr of el.attributes) {
                attributes[attr.name] = attr.value;
            }

            // Get classes as array
            const classes = Array.from(el.classList);

            return {
                tagName: el.tagName.toLowerCase(),
                classes: classes,
                attributes: attributes,
                textContent: el.textContent?.trim().substring(0, 100) || '', // Limit text length
                role: el.getAttribute('role') || undefined,
                placeholder: el.getAttribute('placeholder') || undefined,
                type: el.getAttribute('type') || undefined,
                href: el.getAttribute('href') || undefined,
                src: el.getAttribute('src') || undefined,
            };
        });

        return characteristics;
    }

    // Generate a CSS selector for an element
    async generateSelector(element: ElementHandle): Promise<string> {
        return await element.evaluate((el: Element) => {
            // Simple selector generation - can be enhanced
            let selector = el.tagName.toLowerCase();
            
            if (el.id) {
                selector = `#${el.id}`;
            } else if (el.className) {
                const classes = Array.from(el.classList).slice(0, 3); // Limit to 3 classes
                if (classes.length > 0) {
                    selector += '.' + classes.join('.');
                }
            }

            return selector;
        });
    }

    // Generate XPath for an element
    async generateXPath(element: ElementHandle): Promise<string> {
        return await element.evaluate((el: Element) => {
            const getXPath = (element: Element): string => {
                if (element.id) {
                    return `//*[@id="${element.id}"]`;
                }
                
                if (element === document.body) {
                    return '/html/body';
                }
                
                let ix = 0;
                const siblings = element.parentNode?.children;
                if (siblings) {
                    for (let i = 0; i < siblings.length; i++) {
                        const sibling = siblings[i];
                        if (sibling === element) {
                            const tagName = element.tagName.toLowerCase();
                            const parent = element.parentElement;
                            const parentPath = parent ? getXPath(parent) : '';
                            return `${parentPath}/${tagName}[${ix + 1}]`;
                        }
                        if (sibling.tagName === element.tagName) {
                            ix++;
                        }
                    }
                }
                return '';
            };
            
            return getXPath(el);
        });
    }

    // Extract all relevant elements from a page
    async extractElementsFromPage(page: Page, url: string): Promise<ElementInfo[]> {
        console.log(`Extracting elements from: ${url}`);
        
        // Define selectors for interactable and semantically significant elements
        const elementSelectors = [
            // Form elements (highly interactable)
            'input[type="text"]',
            'input[type="email"]', 
            'input[type="password"]',
            'input[type="number"]',
            'input[type="tel"]',
            'input[type="url"]',
            'input[type="search"]',
            'input[type="date"]',
            'input[type="time"]',
            'input[type="datetime-local"]',
            'input[type="checkbox"]',
            'input[type="radio"]',
            'input[type="file"]',
            'input[type="submit"]',
            'input[type="button"]',
            'input[type="reset"]',
            'textarea',
            'select',
            'button',
            
            // Navigation and links
            'a[href]',
            'nav a',
            '[role="navigation"] a',
            
            // Interactive elements
            '[role="button"]',
            '[role="tab"]',
            '[role="menuitem"]',
            '[role="link"]',
            '[tabindex]',
            '[onclick]',
            
            // Form containers
            'form',
            'fieldset',
            
            // Semantic content elements
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'main',
            'article',
            'section',
            'header',
            'footer',
            'nav',
            
            // Data elements
            'table',
            '[data-testid]',
            '[data-cy]',
            '[data-test]',
            
            // Elements with meaningful IDs or classes
            '[id]:not([id*="google"]):not([id*="ads"]):not([id*="banner"])',
            '[class*="btn"]:not([class*="ads"]):not([class*="banner"])',
            '[class*="input"]',
            '[class*="form"]',
            '[class*="nav"]',
            '[class*="menu"]',
            '[class*="search"]',
            '[class*="submit"]',
            '[class*="login"]',
            '[class*="signup"]',
            '[class*="register"]',
            
            // Modal and dialog elements
            '[role="dialog"]',
            '[role="alertdialog"]',
            '.modal',
            '.dialog',
            '.popup'
        ];

        const elements: ElementInfo[] = [];

        for (const selector of elementSelectors) {
            try {
                const pageElements = await page.$$(selector);
                
                if (pageElements && Array.isArray(pageElements) && pageElements.length > 0) {
                    console.log(`Found ${pageElements.length} elements for selector: ${selector}`);

                    for (const element of pageElements) {
                        try {
                            // Filter out non-interactable elements
                            const isInteractable = await this.isElementInteractable(element);
                            if (!isInteractable) continue;

                            const characteristics = await this.extractElementCharacteristics(element, page);
                            
                            // Skip decorative or layout elements
                            if (this.isDecorativeElement(characteristics)) continue;

                            const cssSelector = await this.generateSelector(element);
                            const xpath = await this.generateXPath(element);

                            elements.push({
                                selector: cssSelector,
                                characteristics,
                                xpath,
                                pageUrl: url
                            });
                        } catch (error) {
                            console.warn(`Warning: Could not process element with selector ${selector}:`, error);
                        }
                    }
                }
            } catch (error) {
                console.warn(`Warning: Could not find elements with selector ${selector}:`, error);
            }
        }

        console.log(`Extracted ${elements.length} interactable elements from ${url}`);
        return elements;
    }

    // Check if element is interactable
    async isElementInteractable(element: ElementHandle): Promise<boolean> {
        return await element.evaluate((el: Element) => {
            // Check if element is visible
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }

            // Check if element has interactive properties
            const tagName = el.tagName.toLowerCase();
            const interactiveTags = ['input', 'button', 'select', 'textarea', 'a', 'form'];
            
            if (interactiveTags.includes(tagName)) return true;
            if (el.hasAttribute('onclick')) return true;
            if (el.hasAttribute('role') && ['button', 'link', 'tab', 'menuitem'].includes(el.getAttribute('role') || '')) return true;
            if (el.hasAttribute('tabindex')) return true;
            if (el.getAttribute('contenteditable') === 'true') return true;

            // Check for semantic significance
            const semanticTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'main', 'nav', 'header', 'footer', 'article', 'section'];
            if (semanticTags.includes(tagName)) return true;

            return false;
        });
    }

    // Check if element is purely decorative
    private isDecorativeElement(characteristics: ElementCharacteristics): boolean {
        const decorativeClasses = [
            'ad', 'ads', 'advertisement', 'banner', 'promo', 'promotion',
            'decoration', 'ornament', 'divider', 'spacer', 'separator',
            'background', 'bg', 'overlay', 'backdrop', 'shadow',
            'border', 'line', 'dot', 'bullet', 'icon-only'
        ];

        const decorativeIds = [
            'google', 'doubleclick', 'adsystem', 'advertisement',
            'social-share', 'like-button', 'follow-button'
        ];

        // Check classes
        const hasDecorativeClass = characteristics.classes.some(cls => 
            decorativeClasses.some(decorative => cls.toLowerCase().includes(decorative))
        );

        // Check ID
        const id = characteristics.attributes['id'] || '';
        const hasDecorativeId = decorativeIds.some(decorative => 
            id.toLowerCase().includes(decorative)
        );

        // Skip empty text elements that aren't form controls
        const isEmptyText = !characteristics.textContent && 
                           !['input', 'button', 'select', 'textarea'].includes(characteristics.tagName);

        return hasDecorativeClass || hasDecorativeId || isEmptyText;
    }

    // Calculate similarity score between two elements
    calculateSimilarity(element1: ElementInfo, element2: ElementInfo): SimilarityResult {
        const char1 = element1.characteristics;
        const char2 = element2.characteristics;
        const matchingAttributes: string[] = [];
        let score = 0;
        let totalChecks = 0;

        // Compare tag names (high weight)
        totalChecks += 3;
        if (char1.tagName === char2.tagName) {
            score += 3;
            matchingAttributes.push('tagName');
        }

        // Compare classes (medium weight)
        const commonClasses = char1.classes.filter(cls => char2.classes.includes(cls));
        if (commonClasses.length > 0) {
            score += Math.min(commonClasses.length, 2); // Max 2 points for classes
            matchingAttributes.push(`classes(${commonClasses.join(', ')})`);
        }
        totalChecks += 2;

        // Compare specific attributes (medium weight)
        const attributesToCheck = ['type', 'role', 'placeholder'];
        attributesToCheck.forEach(attr => {
            totalChecks += 1;
            if (char1[attr as keyof ElementCharacteristics] && 
                char1[attr as keyof ElementCharacteristics] === char2[attr as keyof ElementCharacteristics]) {
                score += 1;
                matchingAttributes.push(attr);
            }
        });

        // Compare text content similarity (low weight)
        totalChecks += 1;
        if (char1.textContent && char2.textContent) {
            const text1 = char1.textContent.toLowerCase();
            const text2 = char2.textContent.toLowerCase();
            if (text1 === text2 || (text1.includes(text2) || text2.includes(text1))) {
                score += 0.5;
                matchingAttributes.push('textContent');
            }
        }

        // Calculate percentage similarity
        const similarityScore = totalChecks > 0 ? (score / totalChecks) * 100 : 0;

        return {
            element1,
            element2,
            similarityScore: Math.round(similarityScore * 100) / 100,
            matchingAttributes
        };
    }

    // Find similar elements across all loaded pages
    findSimilarElements(elements: ElementInfo[], minSimilarity: number = 60): SimilarityResult[] {
        const similarities: SimilarityResult[] = [];

        console.log(`Analyzing ${elements.length} elements for similarities...`);

        for (let i = 0; i < elements.length; i++) {
            for (let j = i + 1; j < elements.length; j++) {
                // Skip comparing elements from the same page
                if (elements[i].pageUrl === elements[j].pageUrl) {
                    continue;
                }

                const similarity = this.calculateSimilarity(elements[i], elements[j]);
                
                if (similarity.similarityScore >= minSimilarity) {
                    similarities.push(similarity);
                }
            }
        }

        // Sort by similarity score (highest first)
        similarities.sort((a, b) => b.similarityScore - a.similarityScore);

        console.log(`Found ${similarities.length} similar element pairs above ${minSimilarity}% similarity`);
        return similarities;
    }

    // Group similar elements for POM recommendations
    groupSimilarElements(similarities: SimilarityResult[]): GroupedElement[] {
        const groups: Map<string, GroupedElement> = new Map();

        similarities.forEach(sim => {
            // Create a key based on element characteristics for grouping
            const key = this.createGroupingKey(sim.element1);
            
            if (groups.has(key)) {
                const existing = groups.get(key)!;
                
                // Add pages and selectors if not already present
                if (!existing.pages.includes(sim.element2.pageUrl)) {
                    existing.pages.push(sim.element2.pageUrl);
                    existing.selectors.push(sim.element2.selector);
                }
                
                // Update confidence based on multiple matches
                existing.confidence = Math.max(existing.confidence, sim.similarityScore);
            } else {
                // Create new group
                const newGroup: GroupedElement = {
                    suggestedLocator: this.suggestBestLocator(sim.element1),
                    suggestedName: this.suggestElementName(sim.element1),
                    elementType: sim.element1.characteristics.tagName,
                    commonAttributes: sim.matchingAttributes,
                    pages: [sim.element1.pageUrl, sim.element2.pageUrl],
                    selectors: [sim.element1.selector, sim.element2.selector],
                    confidence: sim.similarityScore,
                    pomRecommendation: this.generatePOMRecommendation(sim.element1)
                };
                
                groups.set(key, newGroup);
            }
        });

        return Array.from(groups.values()).sort((a, b) => b.confidence - a.confidence);
    }

    // Create a key for grouping similar elements
    private createGroupingKey(element: ElementInfo): string {
        const char = element.characteristics;
        return `${char.tagName}-${char.type || 'none'}-${char.role || 'none'}-${char.classes.slice(0, 2).join('-')}`;
    }

    // Suggest the best locator strategy with enhanced stability
    private suggestBestLocator(element: ElementInfo): string {
        const char = element.characteristics;
        
        // Priority order: data-testid > role > semantic attributes > stable attributes > id > meaningful classes
        
        // Highest priority: test attributes
        if (char.attributes['data-testid']) {
            return `[data-testid="${char.attributes['data-testid']}"]`;
        }
        if (char.attributes['data-cy']) {
            return `[data-cy="${char.attributes['data-cy']}"]`;
        }
        if (char.attributes['data-test']) {
            return `[data-test="${char.attributes['data-test']}"]`;
        }
        
        // High priority: semantic roles and ARIA attributes
        if (char.role) {
            if (char.attributes['aria-label']) {
                return `[role="${char.role}"][aria-label="${char.attributes['aria-label']}"]`;
            }
            return `[role="${char.role}"]`;
        }
        
        // ARIA labels are very stable
        if (char.attributes['aria-label']) {
            return `[aria-label="${char.attributes['aria-label']}"]`;
        }
        
        // Semantic HTML elements with meaningful attributes
        if (char.tagName === 'nav' && char.attributes['role'] === 'navigation') {
            return 'nav[role="navigation"]';
        }
        
        // Form elements with stable attributes
        if (char.tagName === 'input' && char.type) {
            if (char.placeholder) {
                return `input[type="${char.type}"][placeholder*="${char.placeholder.substring(0, 20)}"]`;
            }
            if (char.attributes['name']) {
                return `input[type="${char.type}"][name="${char.attributes['name']}"]`;
            }
            return `input[type="${char.type}"]`;
        }
        
        if (char.tagName === 'button' && char.textContent && char.textContent.length < 50) {
            return `button:has-text("${char.textContent}")`;
        }
        
        // Links with stable href patterns
        if (char.tagName === 'a' && char.href) {
            const href = char.href;
            // Use href for navigation links
            if (href.includes('/docs') || href.includes('/api') || href === '/' || href.includes('#')) {
                return `a[href="${href}"]`;
            }
        }
        
        // ID attributes (but avoid dynamic/random ones)
        if (char.attributes['id'] && !this.isDynamicId(char.attributes['id'])) {
            return `#${char.attributes['id']}`;
        }
        
        // Meaningful classes (avoid utility/styling classes)
        if (char.classes && char.classes.length > 0) {
            const meaningfulClass = this.findMeaningfulClass(char.classes);
            if (meaningfulClass) {
                return `.${meaningfulClass}`;
            }
        }
        
        // Semantic elements
        const semanticTags = ['header', 'footer', 'nav', 'main', 'aside', 'section', 'article'];
        if (semanticTags.includes(char.tagName)) {
            return char.tagName;
        }
        
        // Heading elements with text content
        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(char.tagName) && char.textContent) {
            return `${char.tagName}:has-text("${char.textContent.substring(0, 30)}")`;
        }
        
        // Last resort: tag name with additional specificity
        if (char.tagName === 'button') {
            return 'button';
        }
        
        return char.tagName;
    }
    
    // Check if ID appears to be dynamically generated
    private isDynamicId(id: string): boolean {
        // Pattern matching for dynamic IDs
        const dynamicPatterns = [
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, // UUID
            /^[a-f0-9]{16,}$/i, // Long hex strings
            /\d{10,}/, // Long numbers (timestamps)
            /random|temp|generated|uuid|guid/i,
            /^react-[0-9]+/i, // React generated IDs
            /^mui-[0-9]+/i, // Material-UI generated IDs
        ];
        
        return dynamicPatterns.some(pattern => pattern.test(id));
    }
    
    // Find the most meaningful class from a list
    private findMeaningfulClass(classes: string[]): string | null {
        // Priority order for meaningful classes
        const meaningfulPatterns = [
            // Component/semantic classes
            /^(navbar|header|footer|sidebar|content|main|nav|menu)/i,
            /^(btn|button)(?!.*util|.*margin|.*padding)/i,
            /^(form|input|search)(?!.*util|.*margin|.*padding)/i,
            /^(logo|brand|title)/i,
            /^(doc|docs|api|guide)/i,
            /^(toggle|dropdown|modal|dialog)/i,
            /^(theme|dark|light)(?!.*util)/i,
        ];
        
        // Avoid utility/styling classes
        const avoidPatterns = [
            /^(m|p|mt|mb|ml|mr|pt|pb|pl|pr)-?\d/i, // Margin/padding utilities
            /^(w|h|min|max)-?\d/i, // Width/height utilities
            /^(text|bg|border|shadow|rounded)/i, // Styling utilities
            /^(flex|grid|block|inline|relative|absolute)/i, // Layout utilities
            /^(sm|md|lg|xl):/i, // Responsive prefixes
            /util|utility|helper/i,
        ];
        
        for (const pattern of meaningfulPatterns) {
            const meaningfulClass = classes.find(cls => 
                pattern.test(cls) && !avoidPatterns.some(avoid => avoid.test(cls))
            );
            if (meaningfulClass) return meaningfulClass;
        }
        
        // If no meaningful pattern found, return the first non-utility class
        const nonUtilityClass = classes.find(cls => 
            !avoidPatterns.some(avoid => avoid.test(cls)) && cls.length > 2
        );
        
        return nonUtilityClass || null;
    }

    // Suggest a meaningful name for POM with enhanced naming
    private suggestElementName(element: ElementInfo): string {
        const char = element.characteristics;
        
        // Extract meaningful name from various sources
        let baseName = '';
        
        // Priority order for naming
        if (char.attributes['data-testid']) {
            baseName = char.attributes['data-testid'].replace(/[-_]/g, ' ');
        } else if (char.attributes['aria-label']) {
            baseName = char.attributes['aria-label'].toLowerCase();
        } else if (char.attributes['id'] && !this.isDynamicId(char.attributes['id'])) {
            baseName = char.attributes['id'].replace(/[-_]/g, ' ');
        } else if (char.placeholder) {
            baseName = char.placeholder.toLowerCase();
        } else if (char.textContent && char.textContent.length < 50 && char.textContent.length > 0) {
            baseName = char.textContent.toLowerCase();
        } else if (char.attributes['name']) {
            baseName = char.attributes['name'].replace(/[-_]/g, ' ');
        } else if (char.classes && char.classes.length > 0) {
            const meaningfulClass = this.findMeaningfulClass(char.classes);
            if (meaningfulClass) {
                baseName = meaningfulClass.replace(/[-_]/g, ' ');
            } else {
                baseName = char.classes[0].replace(/[-_]/g, ' ');
            }
        } else if (char.href && char.tagName === 'a') {
            // Extract meaningful name from href
            const href = char.href;
            if (href === '/' || href.endsWith('/')) {
                baseName = 'home';
            } else if (href.includes('/docs')) {
                baseName = 'docs';
            } else if (href.includes('/api')) {
                baseName = 'api';
            } else {
                const pathParts = href.split('/').filter(Boolean);
                baseName = pathParts[pathParts.length - 1] || 'link';
            }
        } else {
            baseName = this.getSemanticName(char.tagName, char.role);
        }
        
        // Clean and enhance the base name
        baseName = this.cleanBaseName(baseName);
        
        // Convert to camelCase
        const camelCase = this.toCamelCase(baseName);
        
        // Add appropriate suffix
        const suffix = this.getElementSuffix(char.tagName, char.type, char.role);
        
        return camelCase + suffix;
    }
    
    // Clean the base name by removing common prefixes/suffixes and meaningless words
    private cleanBaseName(name: string): string {
        let cleaned = name.toLowerCase().trim();
        
        // Remove common prefixes
        const prefixesToRemove = ['btn', 'button', 'link', 'nav', 'menu', 'icon', 'img'];
        prefixesToRemove.forEach(prefix => {
            if (cleaned.startsWith(prefix + ' ') || cleaned.startsWith(prefix + '-') || cleaned.startsWith(prefix + '_')) {
                cleaned = cleaned.substring(prefix.length + 1);
            }
        });
        
        // Remove common suffixes
        const suffixesToRemove = [' btn', ' button', ' link', ' icon', ' img'];
        suffixesToRemove.forEach(suffix => {
            if (cleaned.endsWith(suffix)) {
                cleaned = cleaned.substring(0, cleaned.length - suffix.length);
            }
        });
        
        // Replace multiple spaces/dashes/underscores with single space
        cleaned = cleaned.replace(/[-_\s]+/g, ' ').trim();
        
        // If empty after cleaning, provide fallback
        if (!cleaned) {
            cleaned = 'element';
        }
        
        return cleaned;
    }
    
    // Convert string to camelCase
    private toCamelCase(str: string): string {
        return str.replace(/\s+(.)/g, (_, char) => char.toUpperCase())
                 .replace(/[^a-zA-Z0-9]/g, '');
    }
    
    // Get semantic name based on tag and role
    private getSemanticName(tagName: string, role?: string): string {
        if (role) {
            switch (role) {
                case 'navigation': return 'navigation';
                case 'search': return 'search';
                case 'button': return 'button';
                case 'tab': return 'tab';
                case 'tabpanel': return 'tab panel';
                case 'dialog': return 'dialog';
                case 'menu': return 'menu';
                case 'menuitem': return 'menu item';
                default: return role;
            }
        }
        
        switch (tagName) {
            case 'header': return 'header';
            case 'footer': return 'footer';
            case 'nav': return 'navigation';
            case 'main': return 'main content';
            case 'aside': return 'sidebar';
            case 'section': return 'section';
            case 'article': return 'article';
            case 'form': return 'form';
            case 'table': return 'table';
            default: return tagName;
        }
    }

    // Get appropriate suffix for element type with enhanced logic
    private getElementSuffix(tagName: string, type?: string, role?: string): string {
        // Handle role-based suffixes first
        if (role) {
            switch (role) {
                case 'button': return 'Button';
                case 'link': return 'Link';
                case 'tab': return 'Tab';
                case 'tabpanel': return 'Panel';
                case 'dialog': return 'Dialog';
                case 'navigation': return 'Navigation';
                case 'search': return 'Search';
                case 'menu': return 'Menu';
                case 'menuitem': return 'MenuItem';
                default: break;
            }
        }
        
        // Handle tag and type combinations
        if (tagName === 'button' || type === 'submit' || type === 'button') return 'Button';
        if (tagName === 'a') return 'Link';
        
        if (tagName === 'input') {
            switch (type) {
                case 'text': 
                case 'email':
                case 'password':
                case 'number':
                case 'tel':
                case 'url':
                case 'search': return 'Input';
                case 'checkbox': return 'Checkbox';
                case 'radio': return 'Radio';
                case 'file': return 'FileInput';
                case 'date':
                case 'time':
                case 'datetime-local': return 'DateInput';
                default: return 'Input';
            }
        }
        
        if (tagName === 'select') return 'Dropdown';
        if (tagName === 'textarea') return 'Textarea';
        if (tagName === 'form') return 'Form';
        if (tagName === 'table') return 'Table';
        if (tagName === 'nav') return 'Navigation';
        if (tagName === 'header') return 'Header';
        if (tagName === 'footer') return 'Footer';
        if (tagName === 'main') return 'Content';
        if (tagName === 'aside') return 'Sidebar';
        if (tagName === 'section') return 'Section';
        if (tagName === 'article') return 'Article';
        
        // Heading elements
        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) return 'Heading';
        
        return 'Element';
    }

    // Generate POM recommendation
    private generatePOMRecommendation(element: ElementInfo): string {
        const char = element.characteristics;
        const confidence = this.assessLocatorStability(element);
        
        let recommendation = '';
        
        if (confidence === 'high') {
            recommendation = 'Recommended for BasePage - stable across pages';
        } else if (confidence === 'medium') {
            recommendation = 'Consider for BasePage - may need page-specific overrides';
        } else {
            recommendation = 'Page-specific locator - avoid BasePage';
        }
        
        return recommendation;
    }

    // Assess how stable a locator is likely to be
    private assessLocatorStability(element: ElementInfo): 'high' | 'medium' | 'low' {
        const char = element.characteristics;
        
        // High stability indicators
        if (char.attributes['data-testid'] || 
            (char.attributes['id'] && !char.attributes['id'].includes('random')) ||
            char.role) {
            return 'high';
        }
        
        // Medium stability indicators
        if (char.classes && char.classes.some(cls => 
            cls.includes('btn') || cls.includes('nav') || cls.includes('header') ||
            cls.includes('footer') || cls.includes('form'))) {
            return 'medium';
        }
        
        return 'low';
    }

    // Generate a report of similar elements optimized for POM usage
    generatePOMReport(groupedElements: GroupedElement[], outputPath: string = './pom-locators-report.json'): void {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalSimilarElements: groupedElements.length,
                basePageRecommendations: groupedElements.filter(g => g.pomRecommendation.includes('BasePage')).length,
                pageSpecificElements: groupedElements.filter(g => g.pomRecommendation.includes('Page-specific')).length
            },
            basePageCandidates: groupedElements
                .filter(g => g.pomRecommendation.includes('BasePage'))
                .map(g => ({
                    suggestedName: g.suggestedName,
                    locator: g.suggestedLocator,
                    elementType: g.elementType,
                    confidence: g.confidence,
                    appearsOnPages: g.pages.length,
                    pages: g.pages,
                    reason: g.pomRecommendation
                })),
            allSimilarElements: groupedElements.map(g => ({
                suggestedName: g.suggestedName,
                locator: g.suggestedLocator,
                elementType: g.elementType,
                confidence: g.confidence,
                pages: g.pages,
                selectors: g.selectors,
                commonAttributes: g.commonAttributes,
                pomRecommendation: g.pomRecommendation
            }))
        };

        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
        console.log(`POM report saved to: ${outputPath}`);
    }

    // Generate TypeScript BasePage file with proper structure and enhanced organization
    generateBasePageFile(groupedElements: GroupedElement[]): string {
        const basePageCandidates = groupedElements.filter(g => 
            g.pomRecommendation.includes('BasePage') && g.confidence >= 50 // Lowered threshold
        );

        // Enhanced categorization with more specific groupings
        const navigationElements = basePageCandidates.filter(e => this.isNavigationElement(e));
        const headerElements = basePageCandidates.filter(e => this.isHeaderElement(e) && !this.isNavigationElement(e));
        const searchElements = basePageCandidates.filter(e => this.isSearchElement(e));
        const sidebarElements = basePageCandidates.filter(e => this.isSidebarElement(e));
        const contentElements = basePageCandidates.filter(e => this.isContentElement(e));
        const formElements = basePageCandidates.filter(e => this.isFormElement(e) && !this.isSearchElement(e));
        const footerElements = basePageCandidates.filter(e => this.isFooterElement(e));
        const themeElements = basePageCandidates.filter(e => this.isThemeElement(e));
        const utilityElements = basePageCandidates.filter(e => 
            !this.isNavigationElement(e) && !this.isHeaderElement(e) && !this.isSearchElement(e) &&
            !this.isSidebarElement(e) && !this.isContentElement(e) && !this.isFormElement(e) &&
            !this.isFooterElement(e) && !this.isThemeElement(e)
        );

        let code = `import { Page, Locator } from '@playwright/test';\n\n`;
        code += `export class BasePage {\n`;
        code += `    constructor(private page: Page) {\n`;

        // Constructor section with organized element initialization
        code = this.addElementSectionToCode(code, 'Navigation Elements', navigationElements, '        ');
        code = this.addElementSectionToCode(code, 'Header Elements', headerElements, '        ');
        code = this.addElementSectionToCode(code, 'Search Elements', searchElements, '        ');
        code = this.addElementSectionToCode(code, 'Sidebar Elements', sidebarElements, '        ');
        code = this.addElementSectionToCode(code, 'Content Elements', contentElements, '        ');
        code = this.addElementSectionToCode(code, 'Form Elements', formElements, '        ');
        code = this.addElementSectionToCode(code, 'Footer Elements', footerElements, '        ');
        code = this.addElementSectionToCode(code, 'Theme Elements', themeElements, '        ');
        code = this.addElementSectionToCode(code, 'Utility Elements', utilityElements, '        ');

        code += `    }\n\n`;

        // Property declarations with the same organization
        code = this.addPropertySectionToCode(code, 'Navigation Elements', navigationElements, '    ');
        code = this.addPropertySectionToCode(code, 'Header Elements', headerElements, '    ');
        code = this.addPropertySectionToCode(code, 'Search Elements', searchElements, '    ');
        code = this.addPropertySectionToCode(code, 'Sidebar Elements', sidebarElements, '    ');
        code = this.addPropertySectionToCode(code, 'Content Elements', contentElements, '    ');
        code = this.addPropertySectionToCode(code, 'Form Elements', formElements, '    ');
        code = this.addPropertySectionToCode(code, 'Footer Elements', footerElements, '    ');
        code = this.addPropertySectionToCode(code, 'Theme Elements', themeElements, '    ');
        code = this.addPropertySectionToCode(code, 'Utility Elements', utilityElements, '    ');

        // Enhanced utility methods
        code += this.generateUtilityMethods(navigationElements, searchElements, sidebarElements, themeElements);

        code += `}\n`;

        return code;
    }

    // Helper method to add element sections to constructor - returns modified code
    private addElementSectionToCode(code: string, sectionName: string, elements: GroupedElement[], indent: string): string {
        if (elements.length > 0) {
            code += `${indent}// ${sectionName}\n`;
            elements.forEach(element => {
                const locatorString = this.escapeLocatorString(element.suggestedLocator);
                code += `${indent}this.${element.suggestedName} = page.locator('${locatorString}');\n`;
            });
            code += `\n`;
        }
        return code;
    }

    // Helper method to add property sections - returns modified code
    private addPropertySectionToCode(code: string, sectionName: string, elements: GroupedElement[], indent: string): string {
        if (elements.length > 0) {
            code += `${indent}// ${sectionName}\n`;
            elements.forEach(element => {
                code += `${indent}readonly ${element.suggestedName}: Locator;\n`;
            });
            code += `\n`;
        }
        return code;
    }

    // Generate comprehensive utility methods
    private generateUtilityMethods(navigationElements: GroupedElement[], searchElements: GroupedElement[], 
                                 sidebarElements: GroupedElement[], themeElements: GroupedElement[]): string {
        let methods = `    // Navigation Utilities\n\n`;
        
        methods += `    async navigate(url: string): Promise<void> {\n`;
        methods += `        await this.page.goto(url);\n`;
        methods += `    }\n\n`;

        // Add specific navigation methods based on found elements
        navigationElements.forEach(element => {
            if (element.suggestedName.toLowerCase().includes('home')) {
                methods += `    async navigateToHome(): Promise<void> {\n`;
                methods += `        await this.${element.suggestedName}.click();\n`;
                methods += `    }\n\n`;
            } else if (element.suggestedName.toLowerCase().includes('docs')) {
                methods += `    async navigateToDocs(): Promise<void> {\n`;
                methods += `        await this.${element.suggestedName}.click();\n`;
                methods += `    }\n\n`;
            } else if (element.suggestedName.toLowerCase().includes('api')) {
                methods += `    async navigateToAPI(): Promise<void> {\n`;
                methods += `        await this.${element.suggestedName}.click();\n`;
                methods += `    }\n\n`;
            }
        });

        // Search utilities
        if (searchElements.length > 0) {
            methods += `    // Search Utilities\n\n`;
            const searchElement = searchElements[0];
            methods += `    async performSearch(searchTerm: string): Promise<void> {\n`;
            methods += `        await this.${searchElement.suggestedName}.click();\n`;
            methods += `        await this.page.keyboard.type(searchTerm);\n`;
            methods += `        await this.page.keyboard.press('Enter');\n`;
            methods += `    }\n\n`;

            methods += `    async isSearchVisible(): Promise<boolean> {\n`;
            methods += `        return await this.${searchElement.suggestedName}.isVisible();\n`;
            methods += `    }\n\n`;
        }

        // Sidebar utilities
        if (sidebarElements.length > 0) {
            methods += `    // Sidebar Utilities\n\n`;
            const sidebarElement = sidebarElements.find(e => e.suggestedName.toLowerCase().includes('toggle'));
            if (sidebarElement) {
                methods += `    async toggleSidebar(): Promise<void> {\n`;
                methods += `        await this.${sidebarElement.suggestedName}.click();\n`;
                methods += `    }\n\n`;
            }

            const mainSidebar = sidebarElements.find(e => !e.suggestedName.toLowerCase().includes('toggle'));
            if (mainSidebar) {
                methods += `    async isSidebarVisible(): Promise<boolean> {\n`;
                methods += `        return await this.${mainSidebar.suggestedName}.isVisible();\n`;
                methods += `    }\n\n`;
            }
        }

        // Theme utilities
        if (themeElements.length > 0) {
            methods += `    // Theme Utilities\n\n`;
            const themeElement = themeElements[0];
            methods += `    async toggleTheme(): Promise<void> {\n`;
            methods += `        await this.${themeElement.suggestedName}.click();\n`;
            methods += `    }\n\n`;
        }

        // General utilities
        methods += `    // General Utilities\n\n`;
        methods += `    async waitForPageLoad(): Promise<void> {\n`;
        methods += `        await this.page.waitForLoadState('networkidle');\n`;
        methods += `    }\n\n`;

        methods += `    async getPageTitle(): Promise<string> {\n`;
        methods += `        return await this.page.title();\n`;
        methods += `    }\n\n`;

        methods += `    async getCurrentUrl(): Promise<string> {\n`;
        methods += `        return this.page.url();\n`;
        methods += `    }\n\n`;

        return methods;
    }

    // Escape locator strings to prevent syntax errors
    private escapeLocatorString(locator: string): string {
        return locator.replace(/'/g, "\\'").replace(/"/g, '\\"');
    }

    // Enhanced categorization helper methods with more specific detection
    private isNavigationElement(element: GroupedElement): boolean {
        const name = element.suggestedName.toLowerCase();
        const locator = element.suggestedLocator.toLowerCase();
        const elementType = element.elementType.toLowerCase();
        
        return name.includes('nav') || 
               name.includes('menu') || 
               name.includes('home') ||
               name.includes('docs') ||
               name.includes('api') ||
               locator.includes('nav') || 
               locator.includes('menu') ||
               locator.includes('href=') ||
               elementType === 'nav' ||
               locator.includes('role="navigation"');
    }

    private isHeaderElement(element: GroupedElement): boolean {
        const name = element.suggestedName.toLowerCase();
        const locator = element.suggestedLocator.toLowerCase();
        const elementType = element.elementType.toLowerCase();
        
        return name.includes('header') || 
               name.includes('logo') ||
               name.includes('brand') ||
               locator.includes('header') || 
               locator.includes('logo') ||
               locator.includes('brand') ||
               elementType === 'header';
    }

    private isSearchElement(element: GroupedElement): boolean {
        const name = element.suggestedName.toLowerCase();
        const locator = element.suggestedLocator.toLowerCase();
        
        return name.includes('search') || 
               locator.includes('search') ||
               locator.includes('docsearch') ||
               locator.includes('role="search"');
    }

    private isSidebarElement(element: GroupedElement): boolean {
        const name = element.suggestedName.toLowerCase();
        const locator = element.suggestedLocator.toLowerCase();
        const elementType = element.elementType.toLowerCase();
        
        return name.includes('sidebar') || 
               name.includes('aside') ||
               name.includes('toc') ||
               name.includes('toggle') ||
               locator.includes('sidebar') || 
               locator.includes('aside') ||
               locator.includes('toc') ||
               locator.includes('toggle') ||
               elementType === 'aside';
    }

    private isContentElement(element: GroupedElement): boolean {
        const name = element.suggestedName.toLowerCase();
        const locator = element.suggestedLocator.toLowerCase();
        const elementType = element.elementType.toLowerCase();
        
        return name.includes('main') || 
               name.includes('content') ||
               name.includes('article') ||
               name.includes('title') ||
               name.includes('heading') ||
               locator.includes('main') || 
               locator.includes('content') ||
               locator.includes('article') ||
               elementType === 'main' || 
               elementType === 'section' ||
               elementType === 'article' ||
               ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(elementType);
    }

    private isFooterElement(element: GroupedElement): boolean {
        const name = element.suggestedName.toLowerCase();
        const locator = element.suggestedLocator.toLowerCase();
        const elementType = element.elementType.toLowerCase();
        
        return name.includes('footer') || 
               locator.includes('footer') || 
               elementType === 'footer';
    }

    private isFormElement(element: GroupedElement): boolean {
        const formTypes = ['input', 'button', 'select', 'textarea', 'form'];
        const name = element.suggestedName.toLowerCase();
        
        return formTypes.includes(element.elementType) || 
               name.includes('form') ||
               name.includes('input') ||
               name.includes('button') ||
               name.includes('dropdown') ||
               name.includes('checkbox') ||
               name.includes('radio');
    }

    private isThemeElement(element: GroupedElement): boolean {
        const name = element.suggestedName.toLowerCase();
        const locator = element.suggestedLocator.toLowerCase();
        
        return name.includes('theme') || 
               name.includes('dark') ||
               name.includes('light') ||
               locator.includes('theme') ||
               locator.includes('dark') ||
               locator.includes('light') ||
               locator.includes('color-mode');
    }

    // Create basic elements from all found elements when no similarities are found
    createBasicElementsFromAll(allElements: ElementInfo[]): GroupedElement[] {
        const commonSelectors = new Map<string, ElementInfo[]>();
        
        // Group elements by their locator patterns
        allElements.forEach(element => {
            const key = this.createBasicGroupingKey(element);
            if (!commonSelectors.has(key)) {
                commonSelectors.set(key, []);
            }
            commonSelectors.get(key)!.push(element);
        });
        
        // Convert to GroupedElement format
        const groupedElements: GroupedElement[] = [];
        
        commonSelectors.forEach((elements, key) => {
            if (elements.length >= 2) { // Only include if appears on multiple pages
                const representative = elements[0];
                const uniquePages = [...new Set(elements.map(e => e.pageUrl))];
                
                if (uniquePages.length >= 2) { // Must appear on at least 2 different pages
                    groupedElements.push({
                        suggestedLocator: this.suggestBestLocator(representative),
                        suggestedName: this.suggestElementName(representative),
                        elementType: representative.characteristics.tagName,
                        commonAttributes: Object.keys(representative.characteristics.attributes),
                        pages: uniquePages,
                        selectors: elements.map(e => e.selector),
                        confidence: 80, // High confidence for elements appearing on multiple pages
                        pomRecommendation: 'Recommended for BasePage - appears on multiple pages'
                    });
                }
            }
        });
        
        return groupedElements.sort((a, b) => b.pages.length - a.pages.length);
    }
    
    // Create a simpler grouping key for basic element detection
    private createBasicGroupingKey(element: ElementInfo): string {
        const char = element.characteristics;
        
        // Group by semantic meaning rather than exact characteristics
        if (char.attributes['data-testid']) {
            return `testid-${char.attributes['data-testid']}`;
        }
        
        if (char.role) {
            return `role-${char.role}`;
        }
        
        if (char.tagName === 'a' && char.href) {
            if (char.href === '/' || char.href.endsWith('/')) return 'nav-home';
            if (char.href.includes('/docs')) return 'nav-docs';
            if (char.href.includes('/api')) return 'nav-api';
            return `nav-${char.href.split('/').pop() || 'link'}`;
        }
        
        if (char.tagName === 'nav') return 'navigation';
        if (char.tagName === 'header') return 'header';
        if (char.tagName === 'footer') return 'footer';
        if (char.tagName === 'main') return 'main-content';
        if (char.tagName === 'aside') return 'sidebar';
        
        if (char.classes.some(cls => cls.toLowerCase().includes('search'))) {
            return 'search';
        }
        
        if (char.classes.some(cls => cls.toLowerCase().includes('toggle'))) {
            return 'toggle';
        }
        
        if (char.classes.some(cls => cls.toLowerCase().includes('theme'))) {
            return 'theme';
        }
        
        return `${char.tagName}-${char.type || 'default'}`;
    }
}

// Main function to run the analyzer
async function main() {
    const analyzer = new ElementSimilarityAnalyzer();
    
    // URLs to analyze - MODIFY THIS ARRAY TO CHANGE WHICH URLS TO EXPLORE
    const urls = [
        'https://www.telus.com/en',
        'https://www.telus.com/en/mobility/devices/category/phones?sessionFlow=consumer&linkname=Phones&linktype=ge-meganav',
        'https://www.telus.com/en/mobility/plans?linkname=Plans&linktype=ge-meganav'
    ];
    
    console.log('Starting Element Similarity Analysis...');
    console.log(`Analyzing ${urls.length} URLs for similar elements`);
    console.log('URLs to analyze:', urls);
    
    try {
        await analyzer.initialize();
        
        const allElements: ElementInfo[] = [];
        
        // Process each URL
        console.log('\n=== Processing URLs ===');
        for (const url of urls) {
            try {
                console.log(`\nProcessing: ${url}`);
                const page = await analyzer.navigateToPage(url);
                const elements = await analyzer.extractElementsFromPage(page, url);
                allElements.push(...elements);
            } catch (error) {
                console.error(`Failed to process ${url}:`, error);
                // Continue with other URLs even if one fails
            }
        }
        
        console.log(`\n=== Analysis Complete ===`);
        console.log(`Total elements extracted: ${allElements.length}`);
        
        if (allElements.length === 0) {
            console.log('No elements found to analyze. Check your URLs and try again.');
            return;
        }
        
        // Find similarities between elements with lowered threshold for better detection
        console.log('\n=== Finding Similar Elements ===');
        const similarities = analyzer.findSimilarElements(allElements, 40); // Lowered from 60% to 40%
        
        if (similarities.length === 0) {
            console.log('No similar elements found across pages.');
            console.log('This could mean:');
            console.log('- Pages have very different structures');
            console.log('- Similarity threshold (40%) is too high');
            console.log('- Not enough pages to compare');
            console.log('\nGenerating BasePage with common elements anyway...');
            
            // Generate a basic BasePage even without similarities
            const basicElements = analyzer.createBasicElementsFromAll(allElements);
            const basePageCode = analyzer.generateBasePageFile(basicElements);
            const basePagePath = './BasePage.ts';
            fs.writeFileSync(basePagePath, basePageCode);
            console.log(`Basic BasePage file generated: ${basePagePath}`);
            return;
        }
        
        // Group similar elements for POM recommendations
        console.log('\n=== Grouping Elements for POM Usage ===');
        const groupedElements = analyzer.groupSimilarElements(similarities);
        
        // Generate reports
        console.log('\n=== Generating Reports ===');
        const reportPath = './pom-locators-report.json';
        analyzer.generatePOMReport(groupedElements, reportPath);
        
        // Generate BasePage TypeScript file
        const basePageCode = analyzer.generateBasePageFile(groupedElements);
        const basePagePath = './BasePage.ts';
        fs.writeFileSync(basePagePath, basePageCode);
        console.log(`BasePage file generated: ${basePagePath}`);
        
        // Print summary
        console.log('\n=== Summary ===');
        console.log(` Analyzed ${urls.length} URLs`);
        console.log(` Found ${allElements.length} total elements`);
        console.log(` Identified ${similarities.length} similar element pairs`);
        console.log(` Created ${groupedElements.length} element groups`);
        
        const basePageCandidates = groupedElements.filter(g => g.pomRecommendation.includes('BasePage'));
        console.log(`${basePageCandidates.length} elements recommended for BasePage`);
        
        console.log('\n=== Generated Files ===');
        console.log(` ${reportPath} - Detailed analysis report`);
        console.log(` ${basePagePath} - Generated BasePage class`);
        
        if (basePageCandidates.length > 0) {
            console.log('\n=== Top BasePage Candidates ===');
            basePageCandidates.slice(0, 5).forEach((element, index) => {
                console.log(`${index + 1}. ${element.suggestedName} (${element.confidence}% confidence)`);
                console.log(`   Locator: ${element.suggestedLocator}`);
                console.log(`   Found on ${element.pages.length} pages`);
            });
        }
        
        console.log('\n Analysis complete! Check the generated files for detailed results.');
        
    } catch (error) {
        console.error(' Analysis failed:', error);
    } finally {
        await analyzer.cleanup();
    }
}

// Run the main function
main().catch(error => {
    console.error(' Unhandled error:', error);
    process.exit(1);
});