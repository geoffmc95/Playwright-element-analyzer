# Playwright-element-analyzer
Analyzes all elements on any given set of URL's to establish similar locators to use in your basepage POM. 

## Dependencies: <br/> 

### Install Playwright (includes browser binaries)
```npm install playwright```

### Install TypeScript and Node.js types
```npm install --save-dev typescript @types/node```

### Install ts-node for running TypeScript directly
```npm install --save-dev ts-node```

### Install Playwright browsers (required for the script to work)
```npx playwright install```



## How to use: 
1. Configure URL's. Control F 'const urlsToAnalyze', then add your desired URL's, separated by a comma. <br/>
2. Run ```npx ts-node element-analyzer.ts```
3. View the generated pom-locators-report.json file
