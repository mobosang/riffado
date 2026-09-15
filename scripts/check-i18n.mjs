import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const dictionary = JSON.parse(fs.readFileSync("src/lib/i18n/zh-CN.json", "utf8"));
const allowlist = JSON.parse(fs.readFileSync("src/lib/i18n/allowlist.json", "utf8"));
const attrs = new Set(["title", "subtitle", "description", "label", "placeholder", "aria-label", "aria-description", "alt", "heading", "ariaLabel"]);
const problems = [];

function files(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const name = path.join(directory, entry.name);
        return entry.isDirectory() ? files(name) : /\.tsx?$/.test(name) ? [name] : [];
    });
}

function parameters(value) {
    return [...new Set([...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))].sort().join(",");
}

for (const [source, translation] of Object.entries(dictionary)) {
    if (typeof translation !== "string" || !translation.trim() || parameters(source) !== parameters(translation)) {
        problems.push(`Invalid translation or placeholders: ${source}`);
    }
}

for (const file of files("src")) {
    if (file.includes(`${path.sep}tests${path.sep}`)) continue;
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const covered = (text.includes('from "@/lib/i18n') || /^src\/(components\/(auth|dashboard|settings|settings-sections|recordings)\/|app\/\(auth\)\/)/.test(relative)) && !/\/(billing-section|trial-banner|dev-section)\.tsx$/.test(relative) && !relative.startsWith("src/lib/i18n/");
    function report(node, message) {
        problems.push(`${relative}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${message}`);
    }
    function checkText(node, source) {
        const exceptions = allowlist[relative];
        const allowed = exceptions && Object.hasOwn(exceptions, source) && typeof exceptions[source] === "string" && exceptions[source].trim();
        if (source && /[A-Za-z]/.test(source) && !allowed) report(node, `Untranslated UI: ${source}`);
    }
    function unwrap(node) {
        while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
        return node;
    }
    function checkKey(expression) {
        const node = unwrap(expression);
        if (ts.isStringLiteralLike(node) && !Object.hasOwn(dictionary, node.text)) report(node, `Missing dictionary key: ${node.text}`);
        else if (ts.isTemplateExpression(node) || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)) report(node, "Dynamic translation key: use a static key with named placeholders");
        else if (ts.isConditionalExpression(node)) {
            checkKey(node.whenTrue);
            checkKey(node.whenFalse);
        }
    }
    function checkExpression(expression) {
        const node = unwrap(expression);
        if (ts.isStringLiteralLike(node)) checkText(node, node.text);
        else if (ts.isTemplateExpression(node)) {
            checkText(node.head, node.head.text);
            for (const span of node.templateSpans) {
                checkExpression(span.expression);
                checkText(span.literal, span.literal.text);
            }
        } else if (ts.isConditionalExpression(node)) {
            checkExpression(node.whenTrue);
            checkExpression(node.whenFalse);
        } else if (ts.isBinaryExpression(node)) {
            const kind = node.operatorToken.kind;
            if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(kind)) {
                checkExpression(node.left);
                checkExpression(node.right);
            } else if (kind === ts.SyntaxKind.AmpersandAmpersandToken) checkExpression(node.right);
        }
    }
    function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(sf) === "uiText") {
            const source = node.arguments[0];
            if (source) checkKey(source);
        }
        if (covered) {
            if (ts.isJsxText(node)) checkText(node, node.text.replace(/\s+/g, " ").trim());
            if (ts.isJsxAttribute(node) && attrs.has(node.name.getText(sf)) && node.initializer && ts.isStringLiteralLike(node.initializer)) checkText(node.initializer, node.initializer.text);
            if (ts.isJsxExpression(node) && node.expression && (!ts.isJsxAttribute(node.parent) || attrs.has(node.parent.name.getText(sf)))) checkExpression(node.expression);
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);
}

if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
} else {
    console.log(`Localization checks passed (${Object.keys(dictionary).length} translations).`);
}
