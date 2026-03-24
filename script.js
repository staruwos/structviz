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
    'ilp32': { pointer: 4, long: 4, int: 4 }  
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
    let cleanText = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    let insideStruct = cleanText.match(/\{([\s\S]*?)\}/);
    if (!insideStruct) throw new Error("Could not find struct body {}");
    
    let statements = insideStruct[1].split(';').map(s => s.trim()).filter(s => s);
    let fields = [];

    statements.forEach(stmt => {
        let name, rawType, isPointer, arraySize = 1, isFuncPtr = false;

        // Check for function pointers (int (*my_func)(int, float) or int (*funcs[5])(int))
        let funcPtrMatch = stmt.match(/^(.+?)\s*\(\s*\*\s*([a-zA-Z0-9_]+)\s*(?:\[(\d+)\])?\s*\)\s*\((.*?)\)$/);

        if (funcPtrMatch) {
            rawType = funcPtrMatch[1].trim() + "(*)()"; // Simplify type for tooltip
            name = funcPtrMatch[2];
            isPointer = true;
            isFuncPtr = true;
            arraySize = funcPtrMatch[3] ? parseInt(funcPtrMatch[3]) : 1;
        } else {
            let match = stmt.match(/^(.+?)\s+(\**\s*[a-zA-Z0-9_]+)\s*(?:\[(\d+)\])?$/);
            if (!match) throw new Error(`Syntax error on line: "${stmt};"`);

            rawType = match[1].trim();
            let namePart = match[2].replace(/\s+/g, '');
            arraySize = match[3] ? parseInt(match[3]) : 1;

            isPointer = namePart.includes('*') || rawType.includes('*');
            name = namePart.replace(/\*/g, '');
        }

        let { size, align } = getTypeInfo(rawType, isPointer, arch);

        fields.push({
            name,
            type: isFuncPtr ? rawType : (isPointer ? rawType + '*' : rawType),
            size,
            align,
            count: arraySize
        });
    });

    return fields;
}

function getTypeInfo(typeStr, isPointer, arch) {
    const model = archModels[arch];
    
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
        
        // On 64-bit Linux (LP64), fast16/32 are often implemented as 8 bytes!
        // On 64-bit Windows (LLP64) and 32-bit (ILP32), they remain 4 bytes.
        let fastSize = (arch === 'lp64') ? 8 : 4;
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
