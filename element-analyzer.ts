//To run: npx ts-node element-analyzer.ts
//To change URL's, control + F 'const urlsToAnalyze', then change URL's

// Import statements and type definitions
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
        
        // Define selectors for different types of elements we want to analyze
        const elementSelectors = [
            'button',           // All buttons
            'input',           // All inputs
            'a',               // All links
            'form',            // All forms
            '[data-testid]',   // Elements with test IDs
            '[class*="btn"]',  // Elements with button-like classes
            '[role="button"]', // Elements with button role
            'nav',             // Navigation elements
            'header',          // Header elements
            'footer',          // Footer elements
            '.card',           // Card components
            '.modal',          // Modal components
            '[id]',            // Elements with IDs (limited to avoid too many)
        ];

        const elements: ElementInfo[] = [];

        for (const selector of elementSelectors) {
            try {
                const pageElements = await page.$$(selector);
                console.log(`Found ${pageElements.length} elements for selector: ${selector}`);

                for (const element of pageElements) {
                    try {
                        const characteristics = await this.extractElementCharacteristics(element, page);
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
            } catch (error) {
                console.warn(`Warning: Could not find elements with selector ${selector}:`, error);
            }
        }

        console.log(`Extracted ${elements.length} elements from ${url}`);
        return elements;
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

    // Suggest the best locator strategy
    private suggestBestLocator(element: ElementInfo): string {
        const char = element.characteristics;
        
        // Priority order: data-testid > id > unique class > other attributes
        if (char.attributes['data-testid']) {
            return `[data-testid="${char.attributes['data-testid']}"]`;
        }
        
        if (char.attributes['id']) {
            return `#${char.attributes['id']}`;
        }
        
        if (char.classes && char.classes.length > 0) {
            // Find the most specific class
            const specificClass = char.classes.find(cls => 
                cls.includes('btn') || cls.includes('input') || cls.includes('form') || 
                cls.includes('nav') || cls.includes('header') || cls.includes('footer')
            ) || char.classes[0];
            return `.${specificClass}`;
        }
        
        if (char.type) {
            return `${char.tagName}[type="${char.type}"]`;
        }
        
        if (char.role) {
            return `[role="${char.role}"]`;
        }
        
        return char.tagName;
    }

    // Suggest a meaningful name for POM
    private suggestElementName(element: ElementInfo): string {
        const char = element.characteristics;
        
        // Extract meaningful name from various sources
        let baseName = '';
        
        if (char.attributes['data-testid']) {
            baseName = char.attributes['data-testid'].replace(/[-_]/g, ' ');
        } else if (char.attributes['id']) {
            baseName = char.attributes['id'].replace(/[-_]/g, ' ');
        } else if (char.placeholder) {
            baseName = char.placeholder.toLowerCase();
        } else if (char.textContent && char.textContent.length < 30) {
            baseName = char.textContent.toLowerCase();
        } else if (char.classes && char.classes.length > 0) {
            baseName = char.classes[0].replace(/[-_]/g, ' ');
        } else {
            baseName = char.tagName;
        }
        
        // Convert to camelCase and add appropriate suffix
        const camelCase = baseName.replace(/\s+(.)/g, (_, char) => char.toUpperCase());
        const suffix = this.getElementSuffix(char.tagName, char.type);
        
        return camelCase + suffix;
    }

    // Get appropriate suffix for element type
    private getElementSuffix(tagName: string, type?: string): string {
        if (tagName === 'button' || type === 'submit') return 'Button';
        if (tagName === 'input') {
            if (type === 'text' || !type) return 'Input';
            if (type === 'checkbox') return 'Checkbox';
            if (type === 'radio') return 'Radio';
            return 'Input';
        }
        if (tagName === 'select') return 'Dropdown';
        if (tagName === 'textarea') return 'Textarea';
        if (tagName === 'a') return 'Link';
        if (tagName === 'form') return 'Form';
        if (tagName === 'table') return 'Table';
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

    // Generate TypeScript code suggestions for BasePage
    generateBasePageCode(groupedElements: GroupedElement[]): string {
        const basePageCandidates = groupedElements.filter(g => 
            g.pomRecommendation.includes('BasePage') && g.confidence >= 80
        );

        let code = '// Suggested locators for BasePage.ts\n';
        code += '// Based on cross-page element analysis\n\n';
        code += 'export class BasePage {\n';
        code += '    protected page: Page;\n\n';
        code += '    constructor(page: Page) {\n';
        code += '        this.page = page;\n';
        code += '    }\n\n';
        code += '    // Common elements found across multiple pages\n';

        basePageCandidates.forEach(element => {
            code += `    // Found on ${element.pages.length} pages: ${element.pages.map(p => p.split('/').pop()).join(', ')}\n`;
            code += `    readonly ${element.suggestedName}: Locator = this.page.locator('${element.suggestedLocator}');\n\n`;
        });

        code += '}\n';

        return code;
    }

    // Print a POM-focused summary to console
    printPOMSummary(groupedElements: GroupedElement[]): void {
        console.log('\n' + '='.repeat(60));
        console.log('POM LOCATOR ANALYSIS SUMMARY');
        console.log('='.repeat(60));
        
        const basePageCandidates = groupedElements.filter(g => g.pomRecommendation.includes('BasePage'));
        const pageSpecific = groupedElements.filter(g => g.pomRecommendation.includes('Page-specific'));
        
        console.log(`Total similar elements found: ${groupedElements.length}`);
        console.log(`BasePage candidates: ${basePageCandidates.length}`);
        console.log(`Page-specific elements: ${pageSpecific.length}`);
        
        if (basePageCandidates.length > 0) {
            console.log('\nRECOMMENDED FOR BASEPAGE:');
            console.log('-'.repeat(40));
            
            basePageCandidates.slice(0, 10).forEach((element, index) => {
                console.log(`${index + 1}. ${element.suggestedName}`);
                console.log(`   Locator: ${element.suggestedLocator}`);
                console.log(`   Type: ${element.elementType}`);
                console.log(`   Confidence: ${element.confidence}%`);
                console.log(`   Pages: ${element.pages.map(p => p.split('/').pop()).join(', ')}`);
                console.log(`   Reason: ${element.pomRecommendation}`);
                console.log('');
            });
        }

        if (pageSpecific.length > 0) {
            console.log('\nPAGE-SPECIFIC ELEMENTS (top 5):');
            console.log('-'.repeat(40));
            
            pageSpecific.slice(0, 5).forEach((element, index) => {
                console.log(`${index + 1}. ${element.suggestedName}`);
                console.log(`   Locator: ${element.suggestedLocator}`);
                console.log(`   Type: ${element.elementType}`);
                console.log(`   Pages: ${element.pages.map(p => p.split('/').pop()).join(', ')}`);
                console.log('');
            });
        }
    }
}

// Main execution function
async function analyzeSimilarElements(urls: string[], minSimilarity: number = 60) {
    const analyzer = new ElementSimilarityAnalyzer();
    
    try {
        // Initialize the analyzer
        await analyzer.initialize();
        
        // Extract elements from all pages
        const allElements: ElementInfo[] = [];
        
        for (const url of urls) {
            try {
                const page = await analyzer.navigateToPage(url);
                const elements = await analyzer.extractElementsFromPage(page, url);
                allElements.push(...elements);
                await page.close(); // Close page to save memory
            } catch (error) {
                console.error(`Failed to analyze ${url}:`, error);
            }
        }
        
        // Find similarities
        const similarities = analyzer.findSimilarElements(allElements, minSimilarity);
        
        // Group elements for POM recommendations
        const groupedElements = analyzer.groupSimilarElements(similarities);
        
        // Generate reports
        analyzer.generatePOMReport(groupedElements);
        analyzer.printPOMSummary(groupedElements);
        
        // Generate BasePage code suggestions
        const basePageCode = analyzer.generateBasePageCode(groupedElements);
        fs.writeFileSync('./suggested-basepage.ts', basePageCode);
        console.log('BasePage code suggestions saved to: ./suggested-basepage.ts');
        
    } catch (error) {
        console.error('Analysis failed:', error);
    } finally {
        // Clean up
        await analyzer.cleanup();
    }
}

// Example usage
async function main() {
    // Define the URLs you want to analyze
    const urlsToAnalyze = [
        'https://testautomationpractice.blogspot.com/',
        'https://www.pavanonlinetrainings.com/p/udemy-courses.html',
        'https://www.pavanonlinetrainings.com/',
        'https://www.pavantestingtools.com/',
        'https://testautomationpractice.blogspot.com/p/playwrightpractice.html'
        // Add more URLs as needed
    ];
    
    console.log('Starting POM Locator Analysis...');
    console.log(`Analyzing ${urlsToAnalyze.length} pages for common elements`);
    console.log('URLs:', urlsToAnalyze);
    
    // Run the analysis with 60% minimum similarity threshold
    await analyzeSimilarElements(urlsToAnalyze, 60);
}

// Export for use as a module
export { ElementSimilarityAnalyzer, analyzeSimilarElements };

// Run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}

// package.json for this script
/*
{
  "name": "element-similarity-analyzer",
  "description": "Analyze similar elements across web pages using Playwright",
  "main": "element-analyzer.js",
  "scripts": {
    "build": "tsc element-analyzer.ts",
    "analyze": "npm run build && node element-analyzer.js",
    "dev": "ts-node element-analyzer.ts"
  },
  "dependencies": {
    "playwright": "^1.40.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.0.0"
  }
}
*/

// Usage examples:

// 1. Basic usage with default settings:
// npx ts-node element-analyzer.ts

// 2. Programmatic usage:
/*
import { ElementSimilarityAnalyzer } from './element-analyzer';

const analyzer = new ElementSimilarityAnalyzer();
await analyzer.initialize();

const page1 = await analyzer.navigateToPage('https://example1.com');
const page2 = await analyzer.navigateToPage('https://example2.com');

const elements1 = await analyzer.extractElementsFromPage(page1, 'https://example1.com');
const elements2 = await analyzer.extractElementsFromPage(page2, 'https://example2.com');

const allElements = [...elements1, ...elements2];
const similarities = analyzer.findSimilarElements(allElements, 70);

analyzer.generateReport(similarities, './my-report.json');
await analyzer.cleanup();
*/
