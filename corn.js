const excelFilePath = 'schedule.xlsx';

const readDataByDate=require("./excelReader");
const moment = require('moment');

const dateFormat = 'DD/MM/YYYY';
const currentDate = moment().format(dateFormat);
async function cornScheduler(){
    return readDataByDate(excelFilePath, currentDate)
    .then(data => {
        if (!data) {
            console.log('No data found for today.');
        }
        else{
            return data;
        }
        
    })
    .catch(error => {
        console.error('Error reading Excel file:', error);
    });
}
module.exports=cornScheduler;

