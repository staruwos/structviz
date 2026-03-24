# structviz
A C Struct Alignment Visualizer

# Live Demo
**Live Demo** at: [https://staruwos.github.io/structviz/](https://staruwos.github.io/structviz/)

# Examples
```bash
struct Example {
    char a;
    long b;
    char c;
    void *d;
};
```

```bash
struct ExamplbeB {
    uint_fast16_t fast_val;
    size_t length;
    int (*callback)(void *, int);
    char status;
    ptrdiff_t memory_offset;
    int (*callback_array[3])();
};
```
