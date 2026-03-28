document.getElementById('check-btn').addEventListener('click', processStruct);

const tooltip = document.createElement('div');
tooltip.className = 'global-tooltip';
document.body.appendChild(tooltip);



// Distinct colors for different struct members
const colors = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', 
    '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', 
    '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', 
    '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'
];

// Define the sizing rules for our supported architectures
const archModels = {
    'lp64':  { pointer: 8, long: 8, int: 4 }, 
    'llp64': { pointer: 8, long: 4, int: 4 }, 
    'ilp32': { pointer: 4, long: 4, int: 4 },
    'cc65':  { pointer: 2, long: 4, int: 2 }  
};

function processStruct() {
    const input = document.getElementById('struct-input').value;
    const arch = document.getElementById('arch-select').value;
    const errorMsg = document.getElementById('error-msg');
    
    try {
        errorMsg.classList.add('hidden');
        
        // Process Original Struct
        const fields = parseStruct(input, arch);
        if (fields.length === 0) throw new Error("No valid fields found in struct.");
        const layout = calculateAlignment(fields);
        renderGrid(layout, 'memory-grid', 'total-size');

        // Process Optimized Struct
        /*const optimizedFields = optimizeFields(fields);
        const optimizedCode = generateStructCode(optimizedFields);
        document.getElementById('optimized-input').value = optimizedCode;
        
        const optimizedLayout = calculateAlignment(optimizedFields);
        renderGrid(optimizedLayout, 'optimized-memory-grid', 'optimized-total-size');*/

    } catch (err) {
        errorMsg.textContent = err.message;
        errorMsg.classList.remove('hidden');
    }
}

function parseStruct(text, arch) {
    // Extraction
    let cleanText = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    let bodyMatch = cleanText.match(/\{([\s\S]*)\}/);
    if (!bodyMatch) throw new Error("Could not find struct body { ... }");
    let body = bodyMatch[1].trim();

    // Split by semicolons, but ignore semicolons inside nested braces
    let statements = [];
    let bracketLevel = 0;
    let currentStatement = "";
    
    for (let char of body) {
        if (char === '{') bracketLevel++;
        if (char === '}') bracketLevel--;
        if (char === ';' && bracketLevel === 0) {
            statements.push(currentStatement.trim());
            currentStatement = "";
        } else {
            currentStatement += char;
        }
    }

    let fields = [];

    statements.forEach(stmt => {
        if (!stmt) return;

        // Check for nested struct: "struct Name { ... } var1, var2;"
        let nestedMatch = stmt.match(/^(struct\s+[a-zA-Z0-9_]*\s*\{[\s\S]*\})\s*(.*)$/);
        
        if (nestedMatch) {
            let innerStructCode = nestedMatch[1];
            let instances = nestedMatch[2].split(',').map(s => s.trim()).filter(s => s);
            
            // Recurse to get size/align of the inner struct
            let innerFields = parseStruct(innerStructCode, arch);
            let innerLayout = calculateAlignment(innerFields);
            
            instances.forEach(inst => {
                // Handle arrays for nested structs: "struct Inner a[2];"
                let arrayMatch = inst.match(/^(\**\s*[a-zA-Z0-9_]+)\s*(?:\[(\d+)\])?$/);
                let name = arrayMatch[1].replace(/\*/g, '').trim();
                let isPointer = arrayMatch[1].includes('*');
                let count = arrayMatch[2] ? parseInt(arrayMatch[2]) : 1;

                fields.push({
                    name: name,
                    type: "struct (nested)",
                    size: isPointer ? archModels[arch].pointer : innerLayout.totalSize,
                    align: isPointer ? archModels[arch].pointer : getMaxAlign(innerFields),
                    count: count
                });
            });
        } else {
            // Standard types, including multiple declarations: "int a, *b[2];"
            // Use a regex that stops at the first space/identifier boundary
            let parts = stmt.match(/^(.+?)\s+([^;]+)$/);
            if (!parts) return;

            let typePart = parts[1].trim();
            let vars = parts[2].split(',').map(v => v.trim());

            vars.forEach(v => {
                let funcPtrMatch = v.match(/^\(\s*\*\s*([a-zA-Z0-9_]+)\s*(?:\[(\d+)\])?\s*\)\s*\((.*?)\)$/);
                let name, isPointer, count = 1, displayType = typePart;

                if (funcPtrMatch) {
                    name = funcPtrMatch[1];
                    isPointer = true;
                    count = funcPtrMatch[2] ? parseInt(funcPtrMatch[2]) : 1;
                    displayType += "(*)()";
                } else {
                    let varMatch = v.match(/^(\**\s*[a-zA-Z0-9_]+)\s*(?:\[(\d+)\])?$/);
                    if (!varMatch) return;
                    name = varMatch[1].replace(/\*/g, '').trim();
                    isPointer = varMatch[1].includes('*');
                    count = varMatch[2] ? parseInt(varMatch[2]) : 1;
                }

                let { size, align } = getTypeInfo(typePart, isPointer, arch);
                fields.push({ name, type: displayType, size, align, count });
            });
        }
    });

    return fields;
}

// Helper to find the largest alignment requirement in a struct
function getMaxAlign(fields) {
    return fields.reduce((max, f) => Math.max(max, f.align), 1);
}

function getTypeInfo(typeStr, isPointer, arch) {
    const model = archModels[arch];
    
    // We wrap the original logic in an internal helper so we can 
    // easily override the alignment for 8-bit targets at the end.
    let getRawTypeInfo = () => {
        // All pointers (including function pointers) scale to architecture
        if (isPointer) return { size: model.pointer, align: model.pointer };
        
        let t = typeStr.toLowerCase();

        // Stddef types (Pointer-sized)
        if (t.includes('size_t') || t.includes('intptr_t') || t.includes('ptrdiff_t')) {
            return { size: model.pointer, align: model.pointer };
        }

        // Max types (Typically 8 bytes on all modern standard systems)
        if (t.includes('max_t')) return { size: 8, align: 8 };

        // Exact-width and Least-width types (int32_t, uint_least16_t)
        let exactOrLeastMatch = t.match(/int(?:_least)?(\d+)_t/);
        if (exactOrLeastMatch) {
            let bytes = parseInt(exactOrLeastMatch[1]) / 8;
            return { size: bytes, align: bytes };
        }

        // Fast-width types (int_fast16_t)
        let fastMatch = t.match(/int_fast(\d+)_t/);
        if (fastMatch) {
            let bits = parseInt(fastMatch[1]);
            if (bits === 8) return { size: 1, align: 1 };
            if (bits === 64) return { size: 8, align: 8 };
            
            // Handle architecture-dependent fast types
            let fastSize = 4;
            if (arch === 'lp64') fastSize = 8;
            if (arch === 'cc65') fastSize = (bits >= 32) ? 4 : 2;
            
            return { size: fastSize, align: fastSize };
        }
        
        // Traditional fixed sizes
        if (t.includes('char') || t.includes('int8')) return { size: 1, align: 1 };
        if (t.includes('short') || t.includes('int16')) return { size: 2, align: 2 };
        if (t.includes('long long') || t.includes('double') || t.includes('int64')) return { size: 8, align: 8 };
        
        // Architecture-dependent traditional types
        if (t.includes('long')) return { size: model.long, align: model.long }; 
        if (t.includes('int') || t.includes('float') || t.includes('int32')) return { size: model.int, align: model.int };
        
        // Default fallback
        return { size: model.int, align: model.int }; 
    };

    let result = getRawTypeInfo();

    // The Magic 8-bit Rule:
    // 6502 fetches memory exactly one byte at a time. It doesn't care about alignment boundaries.
    // Therefore, the compiler tightly packs everything with an alignment requirement of 1.
    if (arch === 'cc65') {
        result.align = 1;
    }

    return result;
}

function calculateAlignment(fields) {
    let offset = 0;
    let maxAlign = 1;
    let memoryLayout = [];
    let colorIndex = 0;

    fields.forEach(f => {
        // Calculate padding needed to satisfy alignment
        let padding = (f.align - (offset % f.align)) % f.align;
        
        if (padding > 0) {
            memoryLayout.push({ type: 'padding', size: padding, offset, name: 'Padding' });
            offset += padding;
        }

        // Add actual field
        let totalFieldSize = f.size * f.count;
        memoryLayout.push({ 
            type: 'member', 
            name: f.name, 
            cType: f.type, 
            size: totalFieldSize, 
            offset, 
            color: colors[colorIndex % colors.length] 
        });
        
        offset += totalFieldSize;
        maxAlign = Math.max(maxAlign, f.align);
        colorIndex++;
    });

    // Struct tail padding
    let tailPadding = (maxAlign - (offset % maxAlign)) % maxAlign;
    if (tailPadding > 0) {
        memoryLayout.push({ type: 'padding', size: tailPadding, offset, name: 'Tail Padding' });
        offset += tailPadding;
    }

    return { bytes: memoryLayout, totalSize: offset };
}

// Pass in the specific IDs for the grid and size text
function renderGrid(layoutData, gridId, sizeId) {
    const grid = document.getElementById(gridId);
    const totalSizeEl = document.getElementById(sizeId);
    
    grid.innerHTML = '';
    totalSizeEl.textContent = layoutData.totalSize;

    layoutData.bytes.forEach(block => {
        for (let i = 0; i < block.size; i++) {
            const byteDiv = document.createElement('div');
            
            if (block.type === 'padding') {
                byteDiv.className = 'byte byte-padding';
                byteDiv.setAttribute('data-tooltip', `${block.name} (Byte ${block.offset + i})`);
            } else {
                byteDiv.className = 'byte';
                byteDiv.style.backgroundColor = block.color;
                byteDiv.textContent = block.name.charAt(0);
                byteDiv.setAttribute('data-tooltip', `${block.cType} ${block.name} (Byte ${block.offset + i})`);
                
                if (['#ffe119', '#46f0f0', '#bcf60c', '#aaffc3', '#fffac8'].includes(block.color)) {
                    byteDiv.style.color = '#000';
                }
            }

            // The global tooltip logic still works perfectly here!
            byteDiv.addEventListener('mousemove', (e) => {
                tooltip.textContent = byteDiv.getAttribute('data-tooltip');
                tooltip.style.left = (e.clientX + 15) + 'px'; 
                tooltip.style.top = (e.clientY + 15) + 'px';
                tooltip.classList.add('visible');
            });

            byteDiv.addEventListener('mouseleave', () => {
                tooltip.classList.remove('visible');
            });

            grid.appendChild(byteDiv);
        }
    });
}


function optimizeFields(fields) {
    // Create a shallow copy so we don't mutate the original array
    return [...fields].sort((a, b) => b.align - a.align);
}

// Reconstructs the C code from the parsed field objects
function generateStructCode(fields) {
    let code = "struct OptimizedExample {\n";
    fields.forEach(f => {
        // Handle array syntax if count > 1
        let arrayStr = f.count > 1 ? `[${f.count}]` : "";
        code += `    ${f.type} ${f.name}${arrayStr};\n`;
    });
    code += "};";
    return code;
}
