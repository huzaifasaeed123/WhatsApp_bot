const ExcelJS = require('exceljs');
const moment = require('moment');
const cron = require('node-cron');

const excelFilePath = 'path/to/your/excel/file.xlsx';
const dateFormat = 'DD/MM/YYYY';

async function readDataByDate(filePath, targetDate) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];

    let foundData = null;

    worksheet.eachRow((row, rowNumber) => {
        const excelDate = row.getCell(1).text;
         const formattedExcelDate = moment(new Date(excelDate)).format(dateFormat);
        if (formattedExcelDate == targetDate) {
            foundData = row.values;
            console.log(`Data found for ${targetDate}:`, foundData);
        }
    });

    return foundData;
}

module.exports=readDataByDate;

