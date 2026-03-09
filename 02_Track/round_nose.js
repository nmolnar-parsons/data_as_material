// Use d3 to load prepared CSV, create visualization, and export


// Dimensions

    // Poster is  18x24 inches, which is a 3:4 aspect ratio. 
const viz_dimensions = {
    width: 1800,
    height: 2400,
    margin: {
        top: 100,
        bottom: 100,
        right: 300,
        left: 300
    }
}

// Create SVG canvas
const svg = d3.select("#viz")
    .append("svg")
    .attr("width", viz_dimensions.width)
    .attr("height", viz_dimensions.height)
    // center the SVG in the container
    .style("display", "block")
    .style("margin", "0 auto")
    .style("background-color", "#f9f9f9"); // light background for better contrast

// Load prepared CSV data
d3.csv("nosetouch_data_prepared_trimmed.csv").then(data => {
    console.log(data); // Check the loaded data
    
    //console log all locations in dataset
    const locations = Array.from(new Set(data.map(d => d.location)));
    console.log("Locations in dataset:", locations);


    // // use hour for x-axis
    const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.hour))
        .range([viz_dimensions.margin.left, viz_dimensions.width - viz_dimensions.margin.right]);

    // //alterantive x: using a lienar scale based 

    const y = d3.scaleOrdinal()
        .domain(["0", "1"])
        .range([viz_dimensions.height * 0.55, viz_dimensions.height * 0.45]); // Position at 30% and 70% of height

    //diagonal data

    data.forEach(d => {
        d.datetime = new Date(d.datetime);
        d.hour = d3.timeHour(d.datetime); // Group by hour
    });
    console.log(data); // Check the data with hour grouping

    // Create a scale for position along the diagonal
    const diagonalScale = d3.scaleTime()
        .domain(d3.extent(data, d => d.hour))
        .range([0, 1]); // 0 = start (top-left), 1 = end (left, 400px above bottom)

    // Define nose curve points
    const noseStart = { x: viz_dimensions.margin.right + 300, y: viz_dimensions.margin.top + 100};
    const noseEnd = { x: viz_dimensions.margin.right, y: viz_dimensions.height - viz_dimensions.margin.bottom - 500 };
    
    // Control points for cubic bezier curve to create nose shape
    const control1 = { x: viz_dimensions.margin.right + 200, y: viz_dimensions.margin.top + 1000 }; // Bridge
    const control2 = { x: viz_dimensions.margin.right + 2400, y: viz_dimensions.height - viz_dimensions.margin.bottom - 250 }; // Tip
    
    // Function to get point along cubic bezier curve
    const getPointOnCurve = (t) => {
        const x = Math.pow(1-t, 3) * noseStart.x + 
                  3 * Math.pow(1-t, 2) * t * control1.x + 
                  3 * (1-t) * Math.pow(t, 2) * control2.x + 
                  Math.pow(t, 3) * noseEnd.x;
        const y = Math.pow(1-t, 3) * noseStart.y + 
                  3 * Math.pow(1-t, 2) * t * control1.y + 
                  3 * (1-t) * Math.pow(t, 2) * control2.y + 
                  Math.pow(t, 3) * noseEnd.y;
        return { x, y };
    };
    
    // Function to get tangent (derivative) at point on curve for perpendicular offset
    const getTangentAtPoint = (t) => {
        const dx = -3 * Math.pow(1-t, 2) * noseStart.x + 
                   3 * Math.pow(1-t, 2) * control1.x - 6 * t * (1-t) * control1.x + 
                   6 * t * (1-t) * control2.x - 3 * Math.pow(t, 2) * control2.x + 
                   3 * Math.pow(t, 2) * noseEnd.x;
        const dy = -3 * Math.pow(1-t, 2) * noseStart.y + 
                   3 * Math.pow(1-t, 2) * control1.y - 6 * t * (1-t) * control1.y + 
                   6 * t * (1-t) * control2.y - 3 * Math.pow(t, 2) * control2.y + 
                   3 * Math.pow(t, 2) * noseEnd.y;
        const angle = Math.atan2(dy, dx);
        return angle;
    };

    // Calculate x,y position along curve based on time
    const getDiagonalX = (d) => {
        const t = diagonalScale(d.hour);
        const point = getPointOnCurve(t);
        return point.x;
    };

    const getDiagonalY = (d) => {
        const t = diagonalScale(d.hour);
        const point = getPointOnCurve(t);
        return point.y;
    };

    // Offset perpendicular to curve for left/right sides
    const perpendicularOffset = 80; // Distance from curve line


    const stackOffset = 50; // Vertical offset between stacked points
    const jitter = 40; // add slight jitter to all points

    // Define SVG path data for custom symbols
    const symbolPaths = {
        "Scratch": "M128.22,119.56c25.07,14.03,30.84-15.55,18.33-30.04l-15.04-11.39c-6.38-10.42,3.58-12.79,8.72-9.46l21.53,15.84,15.27,28.45c1.52,2.08,2.38,5.22,2.47,9.6l-.43,56.95-32.81.25,2.26-31.42c-12.71.53-15.54-12.51-31.31-19.53l-13.58-4.04c2.98-8.85,10.06-12.09,24.58-5.2h0ZM129.12,81.54l15.03,11.43c3.07,3.64,5.18,8.64,5.09,13.74-4.69-4.47-7.48-5.9-11.43-6.87-5.79-2.34-8.69-5.19-6.82-8.89-3.02-3.14-4.35-6.27-1.86-9.41h0Z",
        "Pinch": "M182.39,82.26c.23-3.7,1.25-6.97,4.41-7.33,2.12-.25,4.14.93,4.97,2.9.66,1.31,1.03,2.75,1.08,4.22.45,7.6,2.26,39.23,2.26,39.23,0,.35,0,.69-.06,1.04h.02c.66,1.91,1.16,3.86,1.51,5.84.34,2.11.52,4.24.54,6.37-.03,7.31-14.54,37.79-37.92,37.92-7.41.04-20.93-9.49-20.93-9.49l-11.34-11.34c-2.59-2.93-15.12-8.59-16.6-13.04-.99-2.02-.35-4.47,1.5-5.75,1.84-1.84,10.39.42,18.33,4.77.42.23.87.39,1.34.47,4.07.67,8.09,1.61,12.03,2.82,1.93.61,4.02-.21,5-1.98,1.32-2.41,1.8-5.96,3.49-10.84l-13.76-12.35-.26-.15-16.49,3.94c-3.44,1.29-7.27-.45-8.56-3.89,0-.02-.01-.04-.02-.05-.38-3.65.9-4.66,3.6-6.57.68-.38,1.4-.69,2.14-.93l18.65-5.91c1.15-.33,2.37-.37,3.54-.11l-1.87-.21c1.6-.04,3.18.39,4.55,1.22.57.34,1.08.77,1.53,1.26l16.14,12.97-7.83-12.92-14.39-28.52c-1.7-4.03-2.93-6.87,0-9.08,2.93-2.23,5.8-.7,8.03,2.23.3.4,16.57,25.23,21.48,33.46,0,.01,0,.02,0,.02-.05.01-1.72-6.65-5-20l.15.85-1.89-12.96s-.09-7.34,3.37-8.64c.06-.02.13-.03.19-.05,2.9-.67,5.79,1.13,6.46,4.03.17.43,9.26,30.83,11.94,41.52",
        "Brush": "M174.96,116.79c0,.81-.66,1.46-1.46,1.46h-2.7c-.81,0-1.46-.66-1.46-1.46v-36.17c0-3.14-2.54-5.68-5.68-5.68s-5.68,2.54-5.68,5.68v36.17c0,.81-.66,1.46-1.46,1.46h-2.67c-.81,0-1.46-.66-1.46-1.46v-42.11c0-3.14-2.54-5.68-5.68-5.68s-5.68,2.54-5.68,5.68v42.11c0,.81-.66,1.46-1.46,1.46h-2.69c-.81,0-1.46-.66-1.46-1.46v-34.62c0-3.14-2.54-5.68-5.68-5.68h0c-3.14,0-5.68,2.54-5.68,5.68v60.58c0,1.23-1.42,1.91-2.38,1.14l-12.38-9.91c-2.82-2.26-6.89-2.09-9.5.41l-.45.43c-2.18,2.08-2.39,5.48-.5,7.81l25.21,30.99c3.36,4.37,8.57,6.93,14.08,6.93h15.01c18.34,0,33.2-14.87,33.21-33.2v-53.96c0-2.33-1.89-4.22-4.22-4.22h-2.93c-2.33,0-4.18,4.51-4.18,6.84-.01,6.93-.03,13.86-.04,20.79Z",
        "Touch": "M134.67,60.48c-7.48,0-13.57,6.08-13.57,13.57v41.91c-4.41-5.02-11.98-6.13-17.7-2.33-6.23,4.18-7.93,12.59-3.75,18.82l14.31,21.47c6.3,9.43,16.87,15.09,28.22,15.09h24.72c14.05,0,25.44-11.38,25.44-25.44v-25.44c0-7.48-6.08-13.57-13.57-13.57-.95,0-1.87.11-2.76.28-2.48-3.26-6.4-5.36-10.81-5.36-1.46,0-2.86.23-4.18.66-2.46-3.48-6.51-5.74-11.09-5.74-.57,0-1.14.04-1.7.11v-20.46c0-7.48-6.08-13.57-13.57-13.57Z"
    };

    // Create color scale for location
    const locationColors = d3.scaleOrdinal()
        .domain(["Home", "Commute", "School", "Meal", "Gym", "Event"])
        .range(["#366EDE", "#951D12", "#3193AD", "#DB5E0C", "#19A851", "#F3C11B"]);
    
    // Create shape generator for part_of_body
    const bodyPartSymbol = d3.scaleOrdinal()
        .domain(["Hand", "Sleeve", "Shoulder", "Tongue"])
        .range([d3.symbolCircle, d3.symbolSquare, d3.symbolTriangle, d3.symbolDiamond]);
    
    // Create size scale for number_of_times
    const sizeScale = d3.scaleLinear()
        .domain([1, d3.max(data, d => +d.number_of_times)])
        .range([1000, 8000]); // Size in square pixels for d3.symbol

    //create opacity scale for touch type
    const opacityScale = d3.scaleOrdinal()
        .domain(["Touch","Brush","Scratch","Pinch"])
        .range([0.5, 0.7, 0.9, 1.0]);

    // Group data by hour and side to stack overlapping points
    const grouped = d3.group(data, d => `${d.hour.getTime()}-${d.side}`);
    
    // Add stacking index to each point
    grouped.forEach(group => {
        group.forEach((d, i) => {
            d.stackIndex = i;
            d.jitterX = (Math.random() - 0.5) * jitter;
            d.jitterY = (Math.random() - 0.5) * jitter;
        });
    });

    // Add points to the SVG using path elements for different shapes
    svg.selectAll("path.datapoint")
        .data(data)
        .enter()
        .append("path")
        .attr("class", "datapoint")
        .attr("d", d => {
            // Use d3.symbol with bodyPartSymbol scale
            const symbolType = bodyPartSymbol(d.part_of_body);
            const symbolSize = sizeScale(+d.number_of_times);
            return d3.symbol().type(symbolType).size(symbolSize)();
        })
        .attr("transform", d => {
            const t = diagonalScale(d.hour);
            const basePoint = getPointOnCurve(t);
            const angle = getTangentAtPoint(t);
            
            const baseX = basePoint.x;
            const baseY = basePoint.y;
            
            // Handle offset based on side (perpendicular to curve)
            let offsetX = 0, offsetY = 0;
            if (d.side === "Left") {
                // Perpendicular to the left of the tangent
                offsetX = -perpendicularOffset * Math.sin(angle);
                offsetY = perpendicularOffset * Math.cos(angle);
            } else if (d.side === "Right") {
                // Perpendicular to the right of the tangent
                offsetX = perpendicularOffset * Math.sin(angle);
                offsetY = -perpendicularOffset * Math.cos(angle);
            }
            // If side is N/A (empty string), offsetX and offsetY remain 0
            
            // Stack along the perpendicular direction as well
            const stackDirection = d.side === "Left" ? -1 : (d.side === "Right" ? 1 : 0);
            const stackX = d.stackIndex * stackOffset * stackDirection * Math.sin(angle);
            const stackY = -d.stackIndex * stackOffset * stackDirection * Math.cos(angle);
            
            const finalX = baseX + offsetX + stackX + d.jitterX;
            const finalY = baseY + offsetY + stackY + d.jitterY;
            
            // Convert angle to degrees and add 90 to make icons perpendicular to curve. if side is right, rotate 90 degrees in the opposite direction
            let rotationAngle = (angle * 180 / Math.PI);
            if (d.side === "Right") {
                rotationAngle -= 180; // Flip the icon for right side
            }
            
            return `translate(${finalX}, ${finalY}) rotate(${rotationAngle})`;
        })
        // .attr("fill", "none") // No fill, only stroke for the symbol paths
        // fill with color based on location
        .attr("fill", d => locationColors(d.location))
        .attr("opacity", d => opacityScale(d.type))
        .attr("stroke", "black")
        .attr("stroke-width", 2)
             
    





    // Axis
    
    const diagonalAxis = svg.append("g")
        .attr("class", "diagonal-axis");

    // Draw the curved nose axis using cubic bezier
    diagonalAxis.append("path")
        .attr("d", `M ${noseStart.x} ${noseStart.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${noseEnd.x} ${noseEnd.y}`)
        .attr("stroke", "black")
        .attr("stroke-width", 20)
        .attr("fill", "none")
        //send to back so points are on top
        .lower();

    // Add ticks along the curve at every midnight (00:00)
    const tickTimes = d3.timeDay.range(
        d3.min(data, d => d.hour),
        d3.max(data, d => d.hour),
        1
    );
    
    // console.log("Tick times:", tickTimes);
    // console.log("Number of ticks:", tickTimes.length);
    
    // tickTimes.forEach(tick => {
    //     const t = diagonalScale(tick);
    //     const point = getPointOnCurve(t);
    //     const angle = getTangentAtPoint(t);
        
    //     console.log("Tick:", tick, "t:", t, "x:", point.x, "y:", point.y);
        
    //     // Tick mark perpendicular to curve
    //     const tickLength = 10;
    //     diagonalAxis.append("line")
    //         .attr("x1", point.x)
    //         .attr("y1", point.y)
    //         .attr("x2", point.x - tickLength * Math.sin(angle))
    //         .attr("y2", point.y + tickLength * Math.cos(angle))
    //         .attr("stroke", "black")
    //         .attr("stroke-width", 4);
        
    //     // Tick label
    //     const labelOffset = 20;
    //     diagonalAxis.append("text")
    //         .attr("x", point.x - labelOffset * Math.sin(angle))
    //         .attr("y", point.y + labelOffset * Math.cos(angle))
    //         .attr("text-anchor", "middle")
    //         .attr("font-size", "20px")
    //         .text(d3.timeFormat("%b %d")(tick))
    //         .attr("transform", `rotate(${angle * 180 / Math.PI}, ${point.x - labelOffset * Math.sin(angle)}, ${point.y + labelOffset * Math.cos(angle)})`);
    // });





});


