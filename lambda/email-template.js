export default function ({
    front, stage, count, error, faciaPath
}) {
return `
Front ${front} failed pressing on ${stage} for ${count} times saying ${error}.<br>

Check why on <a href="${faciaPath}/troubleshoot/stale/${front}">troubleshoot page</a>.<br>

Cheers
`;
}
